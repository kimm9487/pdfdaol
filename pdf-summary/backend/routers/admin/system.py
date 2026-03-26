from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
from sqlalchemy import text
import datetime
import os
from typing import Optional
from urllib.parse import urlparse

from database import get_db, PdfDocument, User

try:
    import chromadb  # type: ignore
except Exception:
    chromadb = None

system_router = APIRouter(tags=["Admin-System"])


def _assert_admin(db: Session, admin_user_id: Optional[int]) -> None:
    if admin_user_id is None:
        return

    admin_user = db.query(User).filter(User.id == admin_user_id).first()
    if not admin_user or admin_user.role != "admin":
        raise HTTPException(status_code=403, detail="관리자만 이용 가능합니다.")


def _build_chroma_client():
    if chromadb is None:
        raise HTTPException(status_code=500, detail="chromadb 패키지가 설치되어 있지 않습니다.")

    base_url = os.getenv("CHROMA_BASE_URL", "http://chroma:8000")
    parsed = urlparse(base_url)
    host = parsed.hostname or "chroma"
    if parsed.port:
        port = parsed.port
    else:
        port = 443 if parsed.scheme == "https" else 8000
    ssl = parsed.scheme == "https"

    return chromadb.HttpClient(host=host, port=port, ssl=ssl), base_url

@system_router.get("/database-status")
async def get_database_status(db: Session = Depends(get_db)):
    """
    Retrieves database status and statistical information.
    """
    try:
        version_result = db.execute(text("SELECT VERSION()"))
        db_version = version_result.fetchone()[0]
       
        tables_result = db.execute(text("SHOW TABLES"))
        tables = [row[0] for row in tables_result.fetchall()]
       
        table_structure = None
        if 'pdf_documents' in tables:
            structure_result = db.execute(text("DESCRIBE pdf_documents"))
            table_structure = [
                {
                    "field": row[0],
                    "type": row[1],
                    "null": row[2],
                    "key": row[3],
                    "default": row[4],
                    "extra": row[5]
                }
                for row in structure_result.fetchall()
            ]
       
        data_stats = {}
        if 'pdf_documents' in tables:
            total_docs = db.query(PdfDocument).count()
            original_translated = db.query(PdfDocument).filter(PdfDocument.original_translation.isnot(None)).count()
            summary_translated = db.query(PdfDocument).filter(PdfDocument.summary_translation.isnot(None)).count()
            recent_docs = db.query(PdfDocument).order_by(PdfDocument.created_at.desc()).limit(5).all()
            avg_extraction_time = db.execute(text("SELECT AVG(extraction_time_seconds) FROM pdf_documents WHERE extraction_time_seconds IS NOT NULL")).scalar()
            avg_summary_time = db.execute(text("SELECT AVG(summary_time_seconds) FROM pdf_documents WHERE summary_time_seconds IS NOT NULL")).scalar()
            avg_translation_time = db.execute(text("SELECT AVG(translation_time_seconds) FROM pdf_documents WHERE translation_time_seconds IS NOT NULL")).scalar()
           
            data_stats = {
                "total_documents": total_docs,
                "original_translated": original_translated,
                "summary_translated": summary_translated,
                "translation_rate": f"{(original_translated/total_docs*100):.1f}%" if total_docs > 0 else "0%",
                "recent_documents": [
                    {
                        "id": doc.id,
                        "filename": doc.filename,
                        "created_at": doc.created_at.isoformat() if doc.created_at else None,
                        "has_original_translation": bool(doc.original_translation),
                        "has_summary_translation": bool(doc.summary_translation),
                        "char_count": doc.char_count,
                        "total_pages": doc.total_pages,
                        "file_size_mb": f"{doc.file_size_bytes / (1024*1024):.2f}" if doc.file_size_bytes else None
                    }
                    for doc in recent_docs
                ],
                "average_processing_times": {
                    "extraction_seconds": float(avg_extraction_time) if avg_extraction_time else None,
                    "summary_seconds": float(avg_summary_time) if avg_summary_time else None,
                    "translation_seconds": float(avg_translation_time) if avg_translation_time else None
                }
            }
       
        return {
            "database_connection": "✅ 연결 성공",
            "database_version": db_version,
            "tables": tables,
            "pdf_documents_table_exists": 'pdf_documents' in tables,
            "table_structure": table_structure,
            "data_statistics": data_stats,
            "timestamp": datetime.datetime.now().isoformat()
        }
       
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "데이터베이스 상태 확인 실패",
                "message": str(e)
            }
        )



import requests

@system_router.get("/chroma-status")
async def get_chroma_status(
    admin_user_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Chroma VectorDB 상태와 컬렉션 통계를 반환합니다."""
    _assert_admin(db, admin_user_id)
    base_url = os.getenv("CHROMA_BASE_URL", "http://chroma:8000")
    try:
        import json

        # 1. Heartbeat 체크
        heartbeat_resp = requests.get(f"{base_url}/api/v1/heartbeat", timeout=2)
        heartbeat_resp.raise_for_status()
        heartbeat = heartbeat_resp.json() if heartbeat_resp.content else {}
        heartbeat_str = json.dumps(heartbeat, ensure_ascii=False)

        # 2. 컬렉션 목록 조회
        collections_resp = requests.get(f"{base_url}/api/v1/collections", timeout=2)
        collections_resp.raise_for_status()
        collections_json = collections_resp.json()

        if isinstance(collections_json, list):
            collections = collections_json
        elif isinstance(collections_json, dict) and "collections" in collections_json:
            collections = collections_json["collections"]
        else:
            collections = []

        items = []
        for col in collections:
            if isinstance(col, dict):
                name = col.get("name", str(col))
                col_id = col.get("id") or name  # ChromaDB v0.4+는 UUID로 조회
                metadata = col.get("metadata", {})
            else:
                name = str(col)
                col_id = name
                metadata = {}

            count = None
            try:
                # UUID로 먼저 시도, 실패 시 name으로 fallback
                for identifier in [col_id, name]:
                    count_resp = requests.get(
                        f"{base_url}/api/v1/collections/{identifier}/count", timeout=2
                    )
                    if count_resp.status_code == 200:
                        count_json = count_resp.json()
                        # ChromaDB는 bare integer 또는 dict로 반환
                        if isinstance(count_json, int):
                            count = count_json
                        elif isinstance(count_json, dict):
                            count = (
                                count_json.get("count")
                                or count_json.get("document_count")
                                or count_json.get("size")
                            )
                        if count is not None:
                            break  # 성공하면 루프 종료

                if count is None:
                    count = "정보 없음"

            except Exception as e:
                count = f"조회 실패: {str(e)}"

            items.append({
                "name": name,
                "metadata": metadata,
                "count": count,
            })

        return {
            "connected": True,
            "base_url": base_url,
            "heartbeat": heartbeat_str,
            "collection_count": len(items),
            "collections": sorted(items, key=lambda x: x["name"]),
            "timestamp": datetime.datetime.now().isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chroma 상태 조회 실패: {str(e)}")

@system_router.post("/current-username")
async def get_current_username(
    user_id: str = Form(..., description="localStorage에 저장된 userName (full_name 또는 username)"),
    db: Session = Depends(get_db),
):
    """
    (Workaround) Returns the actual username for a given full_name to prevent auth errors on the frontend.
    """
    user = db.query(User).filter(User.username == user_id).first()
    if user:
        return {"username": user.username}

    user = db.query(User).filter(User.full_name == user_id).first()
    if user:
        return {"username": user.username}

    raise HTTPException(
        status_code=404,
        detail="사용자를 찾을 수 없습니다."
    )


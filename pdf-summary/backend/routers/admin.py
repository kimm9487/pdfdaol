from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from database import get_db, User

# 이 이름(router)이 main.py의 'from routers.admin import router'와 매칭됩니다.
router = APIRouter(prefix="/api/admin", tags=["Admin"])

@router.get("/documents")
def get_admin_documents(db: Session = Depends(get_db)):
    try:
        tables_result = db.execute(text("SHOW TABLES")).all()
        tables = [row[0] for row in tables_result]
        
        docs = []
        
        if "pdf_documents" in tables:
            result = db.execute(text("SELECT id, filename, created_at FROM pdf_documents ORDER BY created_at DESC LIMIT 50")).all()
            for row in result:
                docs.append({
                    "id": row[0],
                    "filename": row[1],
                    "created_at": str(row[2]) if row[2] else None,
                    "char_count": 0, "successful_pages": 0, "total_pages": 0, "file_size_bytes": 0,
                    "has_original_translation": False, "has_summary_translation": False,
                    "processing_times": {"extraction": 0, "summary": 0, "translation": 0}
                })
        else:
            users = db.query(User).all()
            for u in users:
                docs.append({
                    "id": u.id,
                    "filename": f"미등록 문서(사용자: {u.full_name})",
                    "created_at": None, "char_count": 0, "successful_pages": 0, "total_pages": 0, "file_size_bytes": 0,
                    "has_original_translation": False, "has_summary_translation": False,
                    "processing_times": {"extraction": 0, "summary": 0, "translation": 0}
                })

        return {
            "documents": docs,
            "pagination": {"total_count": len(docs), "page": 1, "total_pages": 1}
        }
    except Exception as e:
        print(f"Admin Documents Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"문서 목록 조회 실패: {str(e)}")
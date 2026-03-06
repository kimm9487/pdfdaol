# routers/download.py
from fastapi import APIRouter, Body, Depends, HTTPException, Response
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
import io
import csv
import time
import os
from zipfile import ZipFile, ZIP_DEFLATED
import pyzipper
from urllib.parse import quote
import json

from database import get_db, PdfDocument, User, log_admin_activity

router = APIRouter(prefix="/api/admin", tags=["admin-download"])

@router.post("/download-selected")
async def download_selected_documents(
    body: dict = Body(...),
    db: Session = Depends(get_db)
):
    print("[다운로드 요청] 전체 body:", body)
    selected_ids = body.get("selected_ids", [])
    user_id = body.get("user_id")

    if not selected_ids:
        raise HTTPException(status_code=400, detail="선택된 항목이 없습니다.")
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id가 필요합니다.")

    try:
        user_id = int(user_id)
    except:
        raise HTTPException(status_code=400, detail="user_id는 숫자여야 합니다.")

    current_user = db.query(User).filter(User.id == user_id).first()
    if not current_user:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")

    is_admin = getattr(current_user, 'role', None) and current_user.role.lower() == 'admin'
    print(f"[다운로드] 사용자 ID: {user_id} | 관리자: {is_admin} | 선택 ID: {selected_ids}")

    format_type = body.get("format", "auto")
    print("[DEBUG] format_type:", format_type)

    try:
        selected_ids = [int(str(i)) for i in selected_ids if str(i).isdigit()]
    except:
        raise HTTPException(status_code=400, detail="문서 ID는 숫자 리스트여야 합니다.")

    if is_admin:
        documents = (
            db.query(PdfDocument)
            .options(joinedload(PdfDocument.owner))
            .filter(PdfDocument.id.in_(selected_ids))
            .all()
        )
        print(f"[관리자 다운로드] {len(documents)}개 문서 조회 완료")
    else:
        documents = (
            db.query(PdfDocument)
            .options(joinedload(PdfDocument.owner))
            .filter(PdfDocument.id.in_(selected_ids))
            .filter(
                or_(
                    PdfDocument.is_public == True,
                    PdfDocument.user_id == current_user.id
                )
            )
            .all()
        )
        print(f"[일반유저 다운로드] 권한 있는 {len(documents)}개 문서 조회")

    if not documents:
        raise HTTPException(status_code=403, detail="선택한 문서에 접근 권한이 없습니다.")

    important_docs = [doc for doc in documents if doc.is_important]
    normal_docs = [doc for doc in documents if not doc.is_important]
    has_important = len(important_docs) > 0

    print("[DEBUG] has_important:", has_important)
    print("[DEBUG] format_type:", format_type)
    print("[DEBUG] 문서 총 개수:", len(documents))
    print("[DEBUG] 중요 문서 ID 목록:", [doc.id for doc in important_docs])

    if format_type == "zip" or has_important:
        print("[DEBUG] ZIP 모드 진입 → generate_protected_zip_response 호출")
        return await generate_protected_zip_response(normal_docs, important_docs, current_user.username, is_admin)
    else:
        print("[DEBUG] CSV 모드 진입 → 기존 CSV 생성")

        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow([
            "문서ID", "파일명", "생성일시", "사용자 이름", "사용자 ID (username)",
            "사용 모델", "원문자수", "요약 내용 (최대 300자)"
        ])

        for doc in documents:
            if doc.is_important:
                summary_content = "중요 문서: 비밀번호 필요 (스니펫 생략)"
            else:
                summary_content = (doc.summary or "요약 내용 없음")[:300] + ("..." if doc.summary and len(doc.summary) > 300 else "")

            writer.writerow([
                doc.id,
                doc.filename,
                doc.created_at.isoformat() if doc.created_at else "없음",
                doc.owner.full_name if getattr(doc, 'owner', None) and hasattr(doc.owner, 'full_name') else "알수없음",
                doc.owner.username if getattr(doc, 'owner', None) else "N/A",
                doc.model_used,
                doc.char_count,
                summary_content
            ])

        content = output.getvalue().encode("utf-8-sig")
        safe_filename = quote(f"{current_user.username}_선택_요약목록.csv")

        return Response(
            content=content,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}"}
        )


# 헬퍼 함수들 (summary.py에서 그대로 복사)
async def generate_protected_zip_response(normal_docs, important_docs, username, is_admin: bool):
    print("[DEBUG] generate_protected_zip_response 시작 - 관리자:", is_admin, "중요 문서:", len(important_docs))
    main_zip_buffer = io.BytesIO()
    main_zip = ZipFile(main_zip_buffer, 'w', compression=ZIP_DEFLATED)
    try:
        readme_content = (
            "선택한 요약 문서 다운로드 파일입니다.\n\n"
            "사용 방법\n"
            "압축 해제 시 **7-Zip** 또는 호환 프로그램 사용을 강력 권장합니다.\n"
            "(Windows 기본 압축 프로그램은 암호화된 파일을 열 수 없을 수 있습니다)\n\n"
            "1. 일반_문서_목록.csv 및 일반문서 폴더 → 바로 열림\n"
            "2. 중요문서 폴더 안 *_보호됨.zip\n"
            "   • 일반 사용자: 업로드 시 입력한 **4자리 숫자 비밀번호** 입력\n"
            "   • 관리자(admin): 암호 없이 바로 열림\n\n"
            "관리자라면 모든 파일을 바로 확인 가능합니다.\n"
            "암호 입력이 안 될 경우: 7-Zip 최신 버전으로 다시 시도해 주세요."
            ).encode('utf-8')
        main_zip.writestr("README.txt", readme_content)

        if normal_docs:
            normal_csv = await generate_csv_content(normal_docs, is_admin)
            main_zip.writestr("일반_문서_목록.csv", normal_csv.encode('utf-8-sig'))

        for doc in important_docs:
            tmp_path = f"protected_{doc.id}_{int(time.time()*1000)}.zip"
            print(f"[DEBUG] 보호 ZIP 생성 - ID: {doc.id}")
            if is_admin:
                protected_zip = ZipFile(tmp_path, 'w', compression=ZIP_DEFLATED)
                print(f"[관리자 모드] 암호 없이 생성")
            else:
                if not doc.password:
                    print(f"[경고] 문서 {doc.id} 패스워드 없음 - ID로 대체")
                    password = str(doc.id).encode('utf-8')
                else:
                    password = doc.password.encode('utf-8')
                protected_zip = pyzipper.AESZipFile(
                    tmp_path,
                    'w',
                    compression=pyzipper.ZIP_DEFLATED,
                    encryption=pyzipper.WZ_AES
                )
                protected_zip.setpassword(password)
                print(f"[일반 사용자] 비밀번호 적용 - DB 값: {doc.password}")

            content = (
                f"문서 ID: {doc.id}\n"
                f"파일명: {doc.filename}\n"
                f"요약 내용:\n{doc.summary or '요약 내용 없음'}"
            ).encode('utf-8')
            protected_zip.writestr(f"{doc.id}_요약.txt", content)
            protected_zip.close()

            size = os.path.getsize(tmp_path)
            print(f"[DEBUG] 보호 ZIP 크기: {size} bytes")

            with open(tmp_path, 'rb') as f:
                main_zip.writestr(
                    f"중요문서/{doc.id}_{doc.filename}_보호됨.zip",
                    f.read()
                )
            os.remove(tmp_path)
            print(f"[DEBUG] 임시 파일 삭제 완료")

    finally:
        main_zip.close()

    main_zip_buffer.seek(0)
    content = main_zip_buffer.getvalue()
    print(f"[ZIP 완료] 전체 크기: {len(content)} bytes")
    filename = f"{username}_보호된_요약목록.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}
    )


async def generate_csv_content(documents, is_admin: bool):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["문서ID", "파일명", "생성일시", "사용자", "모델", "원문자수", "요약내용", "중요여부", "공개여부"])

    for doc in documents:
        summary_content = doc.summary or "" if is_admin or not doc.is_important else "[중요 문서 - 비밀번호 필요]"
        writer.writerow([
            doc.id,
            doc.filename,
            doc.created_at.isoformat() if doc.created_at else "",
            doc.owner.full_name if doc.owner else "알수없음",
            doc.model_used,
            doc.char_count,
            summary_content,
            "중요" if doc.is_important else "일반",
            "공개" if doc.is_public else "비공개"
        ])
    return output.getvalue()
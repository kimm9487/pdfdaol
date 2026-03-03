from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db, get_user_documents

router = APIRouter()

# [마이페이지 히스토리 조회]
@router.get("/api/history/{user_db_id}")
def get_summary_history(user_db_id: int, db: Session = Depends(get_db)):
    # database.py의 get_user_documents 함수 활용
    documents = get_user_documents(db, user_db_id)
    
    return [
        {
            "id": doc.id,
            "date": doc.created_at.strftime("%Y-%m-%d") if doc.created_at else "",
            "fileName": doc.filename,
            "model": doc.model_used,
            "status": "완료"
        } for doc in documents
    ]

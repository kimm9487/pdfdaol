from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db, PdfDocument

# 라우터 prefix를 /api/history로 설정
router = APIRouter(prefix="/api/history", tags=["History"])

@router.get("/{user_db_id}")
def get_summary_history(user_db_id: int, db: Session = Depends(get_db)):
    from database import get_user_documents
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
import os
import datetime
import httpx
from dotenv import load_dotenv

load_dotenv()

async def send_discord_alert(error_msg: str, user_id: str = "익명", path: str = "알 수 없음", level: str = "info", status_code: int = None):
    webhook_url = os.getenv("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        return

    # 레벨에 따른 색상 설정
    colors = {
        "success": 5763719,  # 초록색
        "info": 3447003,     # 파란색
        "warning": 16753920, # 주황색
        "error": 15548997    # 빨간색
    }
    
    # 전달받은 level이 없으면 기본값(info) 사용
    chosen_color = colors.get(level, colors["info"])
    
    # 레벨에 따른 아이콘 설정 (제목 앞에 붙임)
    icons = {
        "success": "✅",
        "info": "ℹ️",
        "warning": "⚠️",
        "error": "🚨"
    }
    icon = icons.get(level, "🔔")

    payload = {
        "embeds": [{
            "title": f"{icon} 시스템 리포트 ({level.upper()})",
            "color": chosen_color,
            "fields": [
                {"name": "내용", "value": f"```{error_msg}```"},
                {"name": "HTTP 상태코드", "value": str(status_code) if status_code else "-", "inline": True},
                {"name": "사용자 ID", "value": user_id, "inline": True},
                {"name": "발생 경로", "value": path, "inline": True}
            ],
            "timestamp": datetime.datetime.utcnow().isoformat()
        }]
    }

    async with httpx.AsyncClient() as client:
        try:
            await client.post(webhook_url, json=payload)
        except Exception as e:
            print(f"Discord 전송 실패: {e}")
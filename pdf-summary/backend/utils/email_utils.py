import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr

def send_email(email: str, code: str):
    sender_email = "jayyoon.lee98@gmail.com" 
    sender_password = "zbmj cwkk sbwb nuqr" 
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "[PDF 요약] 본인확인 인증번호"
    msg["From"] = formataddr(('PDF 요약 서비스', sender_email)) 
    msg["To"] = email

    # utils 폴더에서 2번 올라가면 backend 폴더, 거기서 templates 찾기
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    template_path = os.path.join(base_dir, "templates", "email_template.html")

    try:
        with open(template_path, "r", encoding="utf-8") as file:
            html_content = file.read()
        html_content = html_content.replace("{{code}}", code)
    except Exception as e:
        print(f"⚠️ HTML 템플릿 읽기 에러: {e}")
        html_content = f"인증번호는 [{code}] 입니다."

    part = MIMEText(html_content, "html", "utf-8")
    msg.attach(part)

    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, email, msg.as_string())
            print(f"✅ {email} 로 HTML 인증 메일 발송 완료!")
    except Exception as e:
        print(f"❌ 이메일 발송 에러: {e}")
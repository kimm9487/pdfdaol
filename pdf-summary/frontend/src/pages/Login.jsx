import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './Login.css';

const Login = ({ setIsLoggedIn }) => {
    const [userId, setUserId] = useState('');
    const [userPw, setUserPw] = useState('');
    const [error, setError] = useState('');
    
    // 아이디 찾기 모달 관련 상태
    const [showFindIdModal, setShowFindIdModal] = useState(false);
    const [email, setEmail] = useState('');
    const [verificationCode, setVerificationCode] = useState('');
    const [isCodeSent, setIsCodeSent] = useState(false);
    const [foundUsername, setFoundUsername] = useState('');

    const navigate = useNavigate();

    // 로그인 로직 (기존 유지)
    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const formData = new FormData();
            formData.append('user_id', userId);
            formData.append('user_pw', userPw);
            
            const response = await fetch("http://localhost:8000/auth/login", {
                method: "POST",
                body: formData,
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem("userName", data.user_name);
                localStorage.setItem("userId", data.user_id);
                localStorage.setItem("userDbId", data.user_db_id);
                localStorage.setItem("isLoggedIn", "true");
                if (setIsLoggedIn) setIsLoggedIn(true);
                alert(`${data.user_name}님 환영합니다!`);
            } else {
                const errorData = await response.json();
                setError(errorData.detail || "로그인에 실패했습니다.");
            }
        } catch (error) {
            setError("서버 연결 실패");
        }
    };

    // 1. 인증번호 발송 함수
    const handleSendCode = async () => {
        const formData = new FormData();
        formData.append('email', email);
        
        try {
            const response = await fetch("http://localhost:8000/auth/send-code", {
                method: "POST",
                body: formData,
            });
            if (response.ok) {
                alert("인증번호가 발송되었습니다.");
                setIsCodeSent(true);
            } else {
                const data = await response.json();
                alert(data.detail);
            }
        } catch (err) {
            alert("서버 연결 실패");
        }
    };

    // 2. 인증번호 확인 및 아이디 찾기 함수
    const handleVerifyCode = async () => {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('code', verificationCode);

        try {
            const response = await fetch("http://localhost:8000/auth/verify-find-id", {
                method: "POST",
                body: formData,
            });
            if (response.ok) {
                const data = await response.json();
                setFoundUsername(data.username);
            } else {
                const data = await response.json();
                alert(data.detail);
            }
        } catch (err) {
            alert("서버 연결 실패");
        }
    };

    return (
        <div className="login-body">
            <div className="login-container">
                <h2>PDF Summary</h2>
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label>아이디</label>
                        <input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} required />
                    </div>
                    <div className="form-group">
                        <label>비밀번호</label>
                        <input type="password" value={userPw} onChange={(e) => setUserPw(e.target.value)} required />
                    </div>
                    {error && <p className="error-msg">{error}</p>}
                    <button type="submit">로그인</button>
                </form>

                <div className="footer-links">
                    <p>계정이 없으신가요? <Link to="/register">회원가입</Link></p>
                    <div className="find-links">
                        <span onClick={() => setShowFindIdModal(true)} style={{cursor: 'pointer'}}>아이디 찾기</span>
                        <span style={{margin: '0 10px'}}>|</span>
                        <span style={{cursor: 'pointer'}}>비밀번호 찾기</span>
                    </div>
                </div>
            </div>

            {/* 아이디 찾기 모달 (Popup) */}
            {showFindIdModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>아이디 찾기</h3>
                        {!foundUsername ? (
                            <>
                                <input 
                                    type="email" 
                                    placeholder="가입한 이메일 입력" 
                                    value={email} 
                                    onChange={(e) => setEmail(e.target.value)} 
                                />
                                <button onClick={handleSendCode}>인증번호 발송</button>
                                
                                {isCodeSent && (
                                    <>
                                        <input 
                                            type="text" 
                                            placeholder="인증번호 6자리" 
                                            value={verificationCode} 
                                            onChange={(e) => setVerificationCode(e.target.value)} 
                                        />
                                        <button onClick={handleVerifyCode}>아이디 확인</button>
                                    </>
                                )}
                            </>
                        ) : (
                            <div className="result-box">
                                <p>고객님의 아이디는 <strong>{foundUsername}</strong> 입니다.</p>
                                <button onClick={() => {
                                    setShowFindIdModal(false);
                                    setFoundUsername('');
                                    setIsCodeSent(false);
                                }}>로그인하러 가기</button>
                            </div>
                        )}
                        <button className="close-btn" onClick={() => setShowFindIdModal(false)}>닫기</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Login;
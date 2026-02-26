import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './Login.css';

const Login = () => {
    const [userId, setUserId] = useState('');
    const [userPw, setUserPw] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
    e.preventDefault();
    try {
        const response = await fetch("http://localhost:8000/auth/login", {
            method: "POST",
            body: new URLSearchParams({ user_id: userId, user_pw: userPw }),
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem("userName", data.user_name);
            localStorage.setItem("isLoggedIn", "true");
    
            alert(`${data.user_name}님 환영합니다!`);
    
            // navigate("/") 대신 아래 코드를 사용하세요.
            window.location.href = "/"; 
        } else {
        alert("로그인 실패");
        }
    } catch (error) {
        console.error("에러 발생:", error);
    }
    };

    return (
        <div className="login-body">
            <div className="login-container">
                <h2>PDF Summary</h2>
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label>아이디</label>
                        <input 
                            type="text" 
                            placeholder="아이디를 입력하세요" 
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            required 
                        />
                    </div>
                    <div className="form-group">
                        <label>비밀번호</label>
                        <input 
                            type="password" 
                            placeholder="비밀번호를 입력하세요" 
                            value={userPw}
                            onChange={(e) => setUserPw(e.target.value)}
                            required 
                        />
                    </div>
                    {error && <p className="error-msg">{error}</p>}
                    <button type="submit">로그인</button>
                </form>

                <div className="footer-links">
                    계정이 없으신가요? <Link to="/register">회원가입</Link>
                </div>
            </div>
        </div>
    );
};

export default Login;
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { buildApiUrl } from '../config/api';
import './Register.css';

const Register = ({ setIsLoggedIn }) => {
    const [formData, setFormData] = useState({
        user_id: '',
        user_pw: '',
        user_pw_confirm: '',
        user_name: '',
        user_email: ''
    });
    const [error, setError] = useState('');
    const [idMessage, setIdMessage] = useState({ text: '', type: '' }); // 아이디 확인 메시지 상태
    const navigate = useNavigate();

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
        // 아이디 입력값이 바뀌면 중복 확인 메시지 초기화
        if (e.target.name === 'user_id') setIdMessage({ text: '', type: '' });
    };

    // 중복확인 함수 추가
    const handleCheckId = async () => {
        if (!formData.user_id) {
            alert("아이디를 입력해주세요.");
            return;
        }

        try {
            const response = await fetch(buildApiUrl(`/auth/check-id?user_id=${formData.user_id}`));
            const data = await response.json();

            if (data.available) {
                setIdMessage({ text: data.message, type: 'success' });
            } else {
                setIdMessage({ text: data.message, type: 'error' });
            }
        } catch (err) {
            alert("서버와 연결할 수 없습니다.");
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');

        if (formData.user_pw !== formData.user_pw_confirm) {
            setError("비밀번호가 일치하지 않습니다.");
            return;
        }

        // 중복확인을 안 했거나 이미 중복된 경우 가입 방지 (선택 사항)
        if (idMessage.type !== 'success') {
            setError("아이디 중복 확인이 필요합니다.");
            return;
        }

        const dataToSend = new FormData();
        dataToSend.append('user_id', formData.user_id);
        dataToSend.append('user_pw', formData.user_pw);
        dataToSend.append('user_name', formData.user_name);
        dataToSend.append('user_email', formData.user_email);

        try {
            const response = await fetch(buildApiUrl('/auth/register'), {
                method: 'POST',
                body: dataToSend,
            });

            if (response.ok) {
                alert("회원가입이 완료되었습니다!");
                navigate('/login');
            } else {
                const result = await response.json();
                setError(result.detail || "회원가입에 실패했습니다.");
            }
        } catch (err) {
            setError("서버와 연결할 수 없습니다.");
        }
    };

    return (
        <div className="register-body">
            <div className="register-container">
                <h2>회원가입</h2>
                <p className="subtitle">PDF Summary 서비스 이용을 위해 가입해주세요.</p>

                <form onSubmit={handleRegister}>
                    <div className="form-group">
                        <label>아이디</label>
                        <div className="input-group">
                            <input 
                                type="text" name="user_id" placeholder="아이디 입력" 
                                value={formData.user_id} onChange={handleChange} required 
                            />
                            {/* 클릭 시 중복확인 함수 호출 */}
                            <button type="button" className="btn-small" onClick={handleCheckId}>중복확인</button>
                        </div>
                        {/* 아이디 확인 메시지 출력 */}
                        {idMessage.text && (
                            <p className={`id-check-msg ${idMessage.type}`}>
                                {idMessage.text}
                            </p>
                        )}
                    </div>

                    <div className="form-group">
                        <label>비밀번호</label>
                        <input type="password" name="user_pw" placeholder="8자 이상 입력" value={formData.user_pw} onChange={handleChange} required />
                    </div>

                    <div className="form-group">
                        <label>비밀번호 확인</label>
                        <input type="password" name="user_pw_confirm" placeholder="비밀번호 다시 입력" value={formData.user_pw_confirm} onChange={handleChange} required />
                    </div>

                    <div className="form-group">
                        <label>이름</label>
                        <input type="text" name="user_name" placeholder="실명을 입력하세요" value={formData.user_name} onChange={handleChange} required />
                    </div>

                    <div className="form-group">
                        <label>이메일</label>
                        <input type="email" name="user_email" placeholder="example@email.com" value={formData.user_email} onChange={handleChange} />
                    </div>

                    {error && <p className="error-msg">{error}</p>}
                    <button type="submit" className="btn-submit">가입 완료</button>
                </form>

                <div className="footer-links">
                    이미 계정이 있으신가요? <Link to="/login">로그인 페이지로</Link>
                </div>
            </div>
        </div>
    );
};

export default Register;
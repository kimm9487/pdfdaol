import React, { useState, useEffect } from 'react';
import { buildApiUrl } from '../../config/api';
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용


const UserManagement = () => {
    const [allUsers, setAllUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadAllUsers = async () => {
        setLoading(true);
        try {
            const response = await fetch(buildApiUrl('/api/admin/users/'), {
                cache: 'no-store'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 회원 목록 조회 실패`);
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                const currentUserId = parseInt(localStorage.getItem('userDbId'));
                const filteredUsers = data.filter(u => u.id !== currentUserId);
                setAllUsers(filteredUsers);
            } else {
                console.warn('예상치 못한 응답 형식:', data);
                setAllUsers([]);
            }
        } catch (err) {
            console.error('회원 목록 로드 오류:', err);
            setAllUsers([]);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteUser = async (userId, username) => {
        if (!window.confirm(`정말 사용자 '${username}'을(를) 삭제하시겠습니까?`)) {
            return;
        }
        try {
            const adminId = localStorage.getItem('userDbId');
            const formData = new FormData();
            formData.append('admin_user_id', adminId);

            const response = await fetch(buildApiUrl(`/api/admin/users/${userId}`), {
                method: 'DELETE',
                body: formData
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 회원 삭제 실패`);
            }
            alert('사용자가 삭제되었습니다.');
            setAllUsers(allUsers.filter(u => u.id !== userId));
        } catch (err) {
            alert('회원 삭제 실패: ' + err.message);
            console.error('회원 삭제 오류:', err);
        }
    };

    useEffect(() => {
        loadAllUsers();
    }, []);

    return (
        <section className="admin-card">
            <div className="card-header">
                <span>👤 회원 관리</span>
                <button className="btn-refresh" onClick={loadAllUsers}>새로고침</button>
            </div>
            {loading ? (
                <div className="loading">회원 목록을 불러오는 중...</div>
            ) : allUsers.length === 0 ? (
                <div className="loading">등록된 회원이 없습니다</div>
            ) : (
                <div className="table-container">
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th>사용자명</th>
                                <th>이메일</th>
                                <th>역할</th>
                                <th>가입일</th>
                                <th>작업</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allUsers.map(user => (
                                <tr key={user.id}>
                                    <td>
                                        <strong>{user.full_name}</strong><br/>
                                        <small style={{ color: '#666' }}>@{user.username}</small>
                                    </td>
                                    <td>{user.email}</td>
                                    <td>
                                        <span className={`badge ${user.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                                            {user.role === 'admin' ? '관리자' : '사용자'}
                                        </span>
                                    </td>
                                    <td>{user.created_at ? user.created_at.split(' ')[0] : '-'}</td>
                                    <td>
                                        <button 
                                            className="btn-danger" 
                                            onClick={() => handleDeleteUser(user.id, user.username)}
                                        >
                                            삭제
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

export default UserManagement;

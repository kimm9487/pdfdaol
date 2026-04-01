import React from 'react';
import './style.css';
import DatabaseStatus from './DatabaseStatus';
import ChromaStatus from './ChromaStatus';
import ActiveSessions from './ActiveSessions';
import UserManagement from './UserManagement';
import DocumentList from './DocumentList';
import PaymentLogList from './PaymentLogList';
import { useAuthRedirect } from '../../hooks/useAuthRedirect';

const AdminDashboard = () => {
    useAuthRedirect();

    return (
        <div className="admin-body">
            <header className="admin-header">
                <h1>📊 PDF 요약 시스템 - 관리자 대시보드</h1>
            </header>

            <div className="admin-container">
                <DatabaseStatus />
                <ChromaStatus />
                <ActiveSessions />
                <UserManagement />
                <DocumentList />
                <PaymentLogList />
            </div>
        </div>
    );
};

export default AdminDashboard;

<<<<<<< HEAD
import React from 'react';
import './style.css';
import DatabaseStatus from './DatabaseStatus';
import ChromaStatus from './ChromaStatus';
import ActiveSessions from './ActiveSessions';
import UserManagement from './UserManagement';
import DocumentList from './DocumentList';
import { useAuthRedirect } from '../../hooks/useAuthRedirect';
=======
import React from "react";
import "./style.css";
import DatabaseStatus from "./DatabaseStatus";
import ChromaStatus from "./ChromaStatus";
import ActiveSessions from "./ActiveSessions";
import UserManagement from "./UserManagement";
import DocumentList from "./DocumentList";
import { useAuthRedirect } from "../../hooks/useAuthRedirect";
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477

const AdminDashboard = () => {
  useAuthRedirect();

  return (
    <div className="admin-body">
      <header className="admin-header">
        <h1>📊 PDF 요약 시스템 - 관리자 대시보드</h1>
      </header>

<<<<<<< HEAD
            <div className="admin-container">
                <DatabaseStatus />
                <ChromaStatus />
                <ActiveSessions />
                <UserManagement />
                <DocumentList />
            </div>
        </div>
    );
=======
      <div className="admin-container">
        <DatabaseStatus />
        <ChromaStatus />
        <ActiveSessions />
        <UserManagement />
        <DocumentList />
      </div>
    </div>
  );
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
};

export default AdminDashboard;

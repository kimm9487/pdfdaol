<<<<<<< HEAD
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
=======
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
>>>>>>> 320fcfe6d8c08cb0618dc26b493c943658a88477
import toast from "react-hot-toast"; // [추가] alert() 대신 toast 알림 사용

/**
 * 사용자가 로그인되어 있지 않으면 로그인 페이지로 리디렉션하는 커스텀 훅
 */
export const useAuthRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const userDbId = localStorage.getItem("userDbId");
    const sessionToken = localStorage.getItem("session_token");

    if (!userDbId || !sessionToken) {
      console.log("로그인 정보 없음, 로그인 페이지로 이동");
      navigate("/login");
    }
  }, [navigate]);
};

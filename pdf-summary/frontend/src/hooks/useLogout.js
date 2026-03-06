import { useNavigate } from 'react-router-dom';
import { useRef } from 'react';
import { buildApiUrl } from '../config/api';

/**
 * 로그아웃 기능을 제공하는 Hook
 * @param {Function} setIsLoggedIn - App에서 제공하는 로그인 상태 업데이트 함수 (선택)
 * @param {Object} options - 옵션 객체
 * @param {boolean} options.showAlert - alert 표시 여부 (기본값: true)
 * @returns {Function} handleLogout - 로그아웃 함수
 */
export const useLogout = (setIsLoggedIn = null, options = {}) => {
  const navigate = useNavigate();
  const { showAlert = true } = options;
  const isLoggingOutRef = useRef(false);

  const handleLogout = async () => {
    if (isLoggingOutRef.current) {
      console.log('이미 로그아웃 처리 중입니다. 중복 호출을 무시합니다.');
      return;
    }

    isLoggingOutRef.current = true;

    try {
      const userDbId = localStorage.getItem('userDbId');
      const sessionToken = localStorage.getItem('session_token');
      
      console.log('로그아웃 시작:', { userDbId, sessionToken: sessionToken ? 'exists' : 'missing' });
      
      // 백엔드로 로그아웃 요청 (선택사항, 실패해도 진행)
      if (userDbId) {
        try {
          const formData = new FormData();
          formData.append('user_id', userDbId);
          if (sessionToken) {
            formData.append('session_token', sessionToken);
          }
          
          const response = await fetch(buildApiUrl('/auth/logout'), {
            method: 'POST',
            body: formData
          });
          console.log('백엔드 로그아웃 응답:', response.status, response.statusText);
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('백엔드 로그아웃 실패:', errorData);
          }
        } catch (err) {
          console.error('백엔드 로그아웃 요청 실패 (계속 진행):', err);
        }
      }
      
      // 로그아웃 완료
      if (setIsLoggedIn) {
        setIsLoggedIn(false);
      }

      // 같은 탭에서도 App 상태를 즉시 동기화하기 위한 이벤트
      window.dispatchEvent(new Event('authStateChanged'));
      
      console.log('✓ 로그아웃 완료');
      
      // localStorage 초기화
      console.log('📦 localStorage 초기화 중...');
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userName");
      localStorage.removeItem("userId"); 
      localStorage.removeItem("userDbId");
      localStorage.removeItem("session_token");
      
      // sessionStorage도 초기화
      sessionStorage.removeItem('forceLoggedOut');
      sessionStorage.removeItem('terminatedUserId');
      
      console.log('✓ 저장소 초기화 완료');
      
      if (showAlert) {
        alert("로그아웃 되었습니다.");
      }
      navigate("/login");
    } catch (err) {
      console.error('로그아웃 중 오류:', err);
      if (showAlert) {
        alert('로그아웃 중 오류가 발생했습니다.');
      }
    } finally {
      // 다음 로그인/로그아웃 사이클을 위해 잠금 해제
      isLoggingOutRef.current = false;
    }
  };

  return handleLogout;
};

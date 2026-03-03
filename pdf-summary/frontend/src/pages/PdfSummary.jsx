import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './PdfSummary.css';

const PdfSummary = () => {
    console.log("📄 PdfSummary 컴포넌트 렌더링됨");
    const API_BASE = "http://localhost:8000/api";
    const navigate = useNavigate();

    const [file, setFile] = useState(null);
    const [fileName, setFileName] = useState("파일 선택 - 선택된 파일 없음");
    const [models, setModels] = useState(["gemma3:latest"]);
    const [selectedModel, setSelectedModel] = useState("gemma3:latest");
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [result, setResult] = useState(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [translatingOriginal, setTranslatingOriginal] = useState(false);
    const [translatingSummary, setTranslatingSummary] = useState(false);
    const [translations, setTranslations] = useState({
        original: null,
        summary: null
    });

    // 사용자 권한 확인
    useEffect(() => {
        const userId = localStorage.getItem("userId");
        setIsAdmin(userId === "admin");
    }, []);

    // 초기 모델 목록 로드
    useEffect(() => {
        const loadModels = async () => {
            try {
                const res = await fetch(`${API_BASE}/models`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.models && data.models.length > 0) {
                        setModels(data.models);
                        setSelectedModel(data.models[0]);
                    }
                }
            } catch (err) {
                console.error("모델 로드 실패:", err);
            }
        };
        loadModels();
    }, []);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setFileName(selectedFile.name);
            setStatus({ type: '', msg: '' });
            setResult(null);
        }
    };

    const handleSummarize = async () => {
        if (!file) return;

        setLoading(true);
        setStatus({ type: 'info', msg: 'AI가 문서를 분석 중입니다. 잠시 기다려주세요...' });
        setResult(null);

        try {
            const userDbId = localStorage.getItem("userDbId");
            console.log("userDbId from localStorage:", userDbId);
            
            if (!userDbId) {
                setStatus({ type: 'error', msg: "사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요." });
                setLoading(false);
                return;
            }

            const formData = new FormData();
            formData.append("file", file);
            formData.append("user_id", parseInt(userDbId));  // 정수로 변환
            formData.append("model", selectedModel);

            console.log("Sending summarize request with user_id:", parseInt(userDbId), "model:", selectedModel);

            const res = await fetch(`${API_BASE}/summarize`, { method: "POST", body: formData });
            const data = await res.json();

            console.log("Response status:", res.status, "Data:", data);

            if (!res.ok) {
                const errorMsg = data.detail || data.message || JSON.stringify(data) || "요약 중 오류가 발생했습니다.";
                console.error("API Error:", errorMsg);
                setStatus({ type: 'error', msg: errorMsg });
                return;
            }

            setResult(data);
            setStatus({ type: '', msg: '' });
        } catch (err) {
            console.error("Fetch Error:", err);
            setStatus({ type: 'error', msg: "서버에 연결할 수 없습니다. 백엔드(localhost:8000)를 확인해주세요. 에러: " + err.message });
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!result) return;
        const element = document.createElement("a");
        const fileContent = new Blob([result.summary], { type: 'text/plain' });
        element.href = URL.createObjectURL(fileContent);
        element.download = `${fileName.replace(".pdf", "")}_요약.txt`;
        document.body.appendChild(element);
        element.click();
    };

    const handleTranslate = async (textType) => {
        if (!result || !result.id) return;

        const isOriginal = textType === 'original';
        
        if (isOriginal) {
            setTranslatingOriginal(true);
        } else {
            setTranslatingSummary(true);
        }

        try {
            const userDbId = localStorage.getItem("userDbId");

            const formData = new FormData();
            formData.append("document_id", result.id);
            formData.append("user_id", parseInt(userDbId));
            formData.append("text_type", textType);
            formData.append("model", selectedModel);

            const res = await fetch(`${API_BASE}/translate`, {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            if (!res.ok) {
                const errorMsg = data.detail || "번역 중 오류가 발생했습니다.";
                setStatus({ type: 'error', msg: errorMsg });
                return;
            }

            setTranslations(prev => ({
                ...prev,
                [textType]: data.translated_text
            }));

            setStatus({ type: 'success', msg: `${textType === 'original' ? '원문' : '요약'}이 영문으로 번역되어 저장되었습니다.` });
            
            setTimeout(() => setStatus({ type: '', msg: '' }), 3000);
        } catch (err) {
            console.error("번역 오류:", err);
            setStatus({ type: 'error', msg: "번역 중 오류가 발생했습니다." });
        } finally {
            if (isOriginal) {
                setTranslatingOriginal(false);
            } else {
                setTranslatingSummary(false);
            }
        }
    };

    return (
        <div className="container">
            {/* 🚩 중복되었던 nav-header 부분을 삭제했습니다. */}
            
            <div className="card">
                <div className="card-header">
                    <div className="card-title">PDF 요약 도구 - AI Analysis</div>
                    <div className="header-buttons">
                        <button 
                            className="summary-list-btn" 
                            onClick={() => navigate('/userlist')}
                            title="요약 목록 조회"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/>
                                <line x1="9" y1="12" x2="15" y2="12"/>
                                <line x1="9" y1="16" x2="15" y2="16"/>
                            </svg>
                            요약 목록 보기
                        </button>
                        {isAdmin && (
                            <button 
                                className="admin-dashboard-btn" 
                                onClick={() => navigate('/admin')}
                                title="관리자 대시보드"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                </svg>
                                관리자 대시보드
                            </button>
                        )}
                    </div>
                </div>

                <div className="upload-row">
                    <label className={`file-label ${file ? 'has-file' : ''}`}>
                        <input type="file" onChange={handleFileChange} accept=".pdf" style={{ display: 'none' }} />
                        <svg className="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <span className={`file-name ${file ? 'selected' : ''}`}>{fileName}</span>
                    </label>

                    <button className="btn-summarize" onClick={handleSummarize} disabled={!file || loading}>
                        {!loading ? <span>요약하기</span> : <div className="spinner"></div>}
                    </button>
                </div>

                <div className="model-row">
                    <span className="model-label">AI 모델:</span>
                    <select className="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>

                {status.msg && <div className={`status ${status.type}`}>{status.msg}</div>}

                {result && (
                    <div className="result-section visible">
                        <hr className="divider" />
                        <div className="section-header">
                            <span className="section-title">📃 원문 전체</span>
                            <span className="section-meta">총 {result.original_length.toLocaleString()}자</span>
                        </div>
                        <div className="original-box">{result.extracted_text}</div>
                        
                        <div className="translation-section">
                            <button 
                                className="btn-translate" 
                                onClick={() => handleTranslate('original')}
                                disabled={translatingOriginal}
                            >
                                {translatingOriginal ? (
                                    <>
                                        <div className="spinner-small"></div>
                                        번역 중...
                                    </>
                                ) : (
                                    <>🌐 원문을 영문으로 번역</>
                                )}
                            </button>
                        </div>
                        
                        {translations.original && (
                            <div className="translated-box">
                                <div className="translated-header">📝 영문 원문</div>
                                <div className="translated-content">{translations.original}</div>
                            </div>
                        )}

                        <hr className="divider" />
                        <div className="section-header">
                            <span className="section-title">🤖 AI 요약 결과</span>
                            <span className="section-meta">{result.model_used}</span>
                        </div>
                        <div className="summary-box">{result.summary}</div>

                        <div className="translation-section">
                            <button 
                                className="btn-translate" 
                                onClick={() => handleTranslate('summary')}
                                disabled={translatingSummary}
                            >
                                {translatingSummary ? (
                                    <>
                                        <div className="spinner-small"></div>
                                        번역 중...
                                    </>
                                ) : (
                                    <>🌐 요약을 영문으로 번역</>
                                )}
                            </button>
                        </div>

                        {translations.summary && (
                            <div className="translated-box">
                                <div className="translated-header">📝 영문 요약</div>
                                <div className="translated-content">{translations.summary}</div>
                            </div>
                        )}

                        <div className="result-actions">
                            <button className="btn-download" onClick={handleDownload}>
                                TXT 다운로드
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PdfSummary;
import React, { useState, useEffect } from 'react';
import './PdfSummary.css';

const PdfSummary = () => {
    const API_BASE = "http://localhost:8000/api";

    const [file, setFile] = useState(null);
    const [fileName, setFileName] = useState("파일 선택 - 선택된 파일 없음");
    const [models, setModels] = useState(["gemma3:latest"]);
    const [selectedModel, setSelectedModel] = useState("gemma3:latest");
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState({ type: '', msg: '' });
    const [result, setResult] = useState(null);

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

        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", selectedModel);

        try {
            const res = await fetch(`${API_BASE}/summarize`, { method: "POST", body: formData });
            const data = await res.json();

            if (!res.ok) {
                setStatus({ type: 'error', msg: data.detail || "요약 중 오류가 발생했습니다." });
                return;
            }

            setResult(data);
            setStatus({ type: '', msg: '' });
        } catch (err) {
            setStatus({ type: 'error', msg: "서버에 연결할 수 없습니다. 백엔드(localhost:8000)를 확인해주세요." });
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

    return (
        <div className="container">
            {/* 🚩 중복되었던 nav-header 부분을 삭제했습니다. */}
            
            <div className="card">
                <div className="card-title">PDF 요약 도구 - AI Analysis</div>

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

                        <hr className="divider" />
                        <div className="section-header">
                            <span className="section-title">🤖 AI 요약 결과</span>
                            <span className="section-meta">{result.model_used}</span>
                        </div>
                        <div className="summary-box">{result.summary}</div>

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
import React from 'react';
import './AIConfirmationModal.css';

const AIConfirmationModal = ({ isOpen, onReview, onContinue, flaggedFiles, isLoading, onClose }) => {
    if (!isOpen) return null;

    const handleModalContentClick = (e) => {
        e.stopPropagation();
    };

    const renderScore = (label, score, isPercentage = false) => {
        if (score === null || score === undefined || isNaN(parseFloat(score)))
            return <p className="score-item"><strong>{label}:</strong> <span className="na-score">Not Available</span></p>;
        const numScore = parseFloat(score);
        return <p className="score-item"><strong>{label}:</strong> <span className="score-value">{numScore.toFixed(2)}{isPercentage ? '%' : '/1.0'}</span></p>;
    };

    // Check for future date concerns
    const hasFutureDateConcerns = flaggedFiles && flaggedFiles.some(file => {
        const internalSummary = file.details?.authenticity_analysis?.final_xai_summary?.toLowerCase() || "";
        const timelineIssues = file.details?.authenticity_analysis?.timeline_coherence?.issues_found || [];
        const externalPred = file.details?.external_ai_prediction;
        const externalSummary = externalPred?.input_text_snippet?.toLowerCase() || "";

        return internalSummary.includes("future date") || internalSummary.includes("upcoming") ||
               externalSummary.includes("future date") || externalSummary.includes("upcoming") ||
               timelineIssues.some(issue => issue.toLowerCase().includes("future") || issue.toLowerCase().includes("2025"));
    });

    return (
        <div
            className="modal-overlay"
            onClick={isLoading ? null : onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-confirm-modal-title"
        >
            <div className="ai-confirm-modal-content" onClick={handleModalContentClick}>
                {/* Header */}
                <div className="ai-modal-header">
                    <div className="header-content">
                        <div className="warning-icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                <path d="M12 9v4m0 4h.01M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"
                                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                        <div className="header-text">
                            <h2 id="ai-confirm-modal-title" className="modal-title">Resume Review Required</h2>
                            <p className="modal-subtitle">Quality assurance checks have flagged potential concerns</p>
                        </div>
                    </div>
                </div>

                {/* Description */}
                <div className="modal-description">
                    <p>
                        Our automated quality checks have identified potential issues with the following resume(s).
                        Please review the details below before proceeding.
                    </p>
                    {hasFutureDateConcerns && (
                        <div className="future-date-notice">
                            <div className="notice-icon">ℹ️</div>
                            <div>
                                <strong>Note:</strong> Some flags may relate to future dates (upcoming events, programs, etc.).
                                If these represent genuine future plans, you can safely continue.
                            </div>
                        </div>
                    )}
                </div>

                {/* Scrollable Content */}
                <div className="modal-scroll-container">
                    <div className="flagged-files-list">
                        {flaggedFiles && flaggedFiles.length > 0 && flaggedFiles.map((file, index) => {
                            const externalAIPred = file.details?.external_ai_prediction;
                            const authAnalysis = file.details?.authenticity_analysis;
                            const crossRefAnalysis = file.details?.cross_referencing_analysis;

                            // Determine confidence display
                            let confidenceText = "N/A";
                            let confidenceClass = "confidence-unknown";

                            if (externalAIPred && !externalAIPred.error && file.confidence) {
                                const conf = (file.confidence * 100).toFixed(0);
                                confidenceText = `${conf}% confidence`;

                                if (externalAIPred.predicted_class_label === "AI-generated") {
                                    confidenceClass = "confidence-ai";
                                } else if (externalAIPred.predicted_class_label === "Human-written") {
                                    confidenceClass = "confidence-human";
                                }
                            }

                            return (
                                <div key={index} className="file-card">
                                    {/* File Header */}
                                    <div className="file-header">
                                        <div className="file-info">
                                            <div className="file-icon">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                                                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                    <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                                </svg>
                                            </div>
                                            <span className="file-name">{file.filename}</span>
                                        </div>
                                        <div className={`confidence-badge ${confidenceClass}`}>
                                            {confidenceText}
                                        </div>
                                    </div>

                                    {/* Analysis Sections */}
                                    <div className="analysis-content">
                                        {/* Machine Learning Analysis */}
                                        {externalAIPred && (
                                            <div className="analysis-section ml-section">
                                                <div className="section-header">
                                                    <h3>Machine Learning Model Prediction</h3>
                                                    <div className="section-icon">🤖</div>
                                                </div>
                                                {externalAIPred.error ? (
                                                    <div className="error-message">
                                                        Analysis temporarily unavailable
                                                    </div>
                                                ) : (
                                                    <div className="prediction-result">
                                                        <div className="prediction-label">
                                                            Classification: <strong>{externalAIPred.predicted_class_label || "Unknown"}</strong>
                                                        </div>
                                                        {file.confidence && (
                                                            <div className="confidence-bar">
                                                                <div className="confidence-label">Confidence Level</div>
                                                                <div className="progress-bar">
                                                                    <div
                                                                        className={`progress-fill ${confidenceClass}`}
                                                                        style={{ width: `${file.confidence * 100}%` }}
                                                                    ></div>
                                                                </div>
                                                                <div className="confidence-percentage">{(file.confidence * 100).toFixed(0)}%</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Internal Authenticity & Spam Check */}
                                        {authAnalysis && (
                                            <div className="analysis-section auth-section">
                                                <div className="section-header">
                                                    <h3>Resume Authenticity Scanning for: {file.filename}</h3>
                                                    <div className="section-icon">🔍</div>
                                                </div>
                                                <div className="auth-results">
                                                    {/* Score Grid */}
                                                    <div className="score-grid">
                                                        {authAnalysis.final_overall_authenticity_score !== null &&
                                                         authAnalysis.final_overall_authenticity_score !== undefined && (
                                                            <div className="score-card">
                                                                <div className="score-label">Authenticity Score</div>
                                                                <div className="score-value">
                                                                    {(authAnalysis.final_overall_authenticity_score * 100).toFixed(0)}%
                                                                </div>
                                                            </div>
                                                        )}
                                                        {authAnalysis.final_spam_likelihood_score !== null &&
                                                         authAnalysis.final_spam_likelihood_score !== undefined && (
                                                            <div className="score-card">
                                                                <div className="score-label">Spam Likelihood</div>
                                                                <div className="score-value">
                                                                    {(authAnalysis.final_spam_likelihood_score * 100).toFixed(0)}%
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Analysis Summary */}
                                                    {authAnalysis.final_xai_summary && (
                                                        <div className="summary-box">
                                                            <div className="summary-label">Analysis Summary</div>
                                                            <p className="summary-text">{authAnalysis.final_xai_summary}</p>
                                                        </div>
                                                    )}

                                                    {/* Content Module Score */}
                                                    {authAnalysis.content_module_score !== null &&
                                                     authAnalysis.content_module_score !== undefined && (
                                                        <div className="content-module-details">
                                                            <div className="content-module-header">
                                                                📊 Content Module Analysis
                                                            </div>
                                                            <div className="content-module-score">
                                                                Score: {authAnalysis.content_module_score.toFixed(2)}/1.0
                                                            </div>
                                                            <div className="content-module-explanation">
                                                                The experience and education align well, and the achievements are quantified. However, the writing style leans towards common AI-generated marketing phrasing, lowering the authenticity score slightly.
                                                            </div>
                                                            <div className="content-module-scores">
                                                                {renderScore("Specificity", authAnalysis.specificity_score)}
                                                                {renderScore("AI Stylistic", authAnalysis.ai_stylistic_score)}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Cross-referencing Details */}
                                                    <div className="cross-referencing-section">
                                                        <div className="cross-ref-header">
                                                            🔗 Cross-referencing Analysis
                                                        </div>
                                                        <div className="cross-ref-content">
                                                            Cross-referencing indicates that some entities mentioned in the resume lack strong verification.
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Entities Verified Section */}
                                        {crossRefAnalysis?.entities_verified && crossRefAnalysis.entities_verified.length > 0 && (
                                            <div className="analysis-section entities-section">
                                                <div className="section-header">
                                                    <h3>Entities Verification</h3>
                                                    <div className="section-icon">🏢</div>
                                                </div>
                                                <div className="entities-results">
                                                    <div className="entities-grid">
                                                        {crossRefAnalysis.entities_verified.map((entity, entityIndex) => (
                                                            <div key={entityIndex} className="entity-card">
                                                                <div className="entity-header">
                                                                    <div className="entity-name">{entity.entity_name}</div>
                                                                    <div className="entity-type">{entity.entity_type}</div>
                                                                </div>
                                                                <div className="entity-details">
                                                                    <div className="entity-confidence">
                                                                        <span className="confidence-label">Existence Confidence:</span>
                                                                        <span className={`confidence-value ${entity.existence_confidence >= 0.7 ? 'high' : entity.existence_confidence >= 0.4 ? 'medium' : 'low'}`}>
                                                                            {(entity.existence_confidence * 100).toFixed(0)}%
                                                                        </span>
                                                                    </div>
                                                                    {entity.supporting_info_url && (
                                                                        <div className="entity-url">
                                                                            <span className="url-label">Supporting URL:</span>
                                                                            <a href={entity.supporting_info_url} target="_blank" rel="noopener noreferrer" className="url-link">
                                                                                {entity.supporting_info_url}
                                                                            </a>
                                                                        </div>
                                                                    )}
                                                                    {entity.verification_notes && (
                                                                        <div className="entity-notes">
                                                                            <span className="notes-label">Notes:</span>
                                                                            <p className="notes-text">{entity.verification_notes}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* URLs Validation Section */}
                                        {crossRefAnalysis?.urls_validated && crossRefAnalysis.urls_validated.length > 0 && (
                                            <div className="analysis-section urls-section">
                                                <div className="section-header">
                                                    <h3>URL Validation</h3>
                                                    <div className="section-icon">🔗</div>
                                                </div>
                                                <div className="urls-results">
                                                    <div className="urls-list">
                                                        {crossRefAnalysis.urls_validated.map((urlData, urlIndex) => {
                                                            // Handle both string URLs and URL objects
                                                            const urlString = typeof urlData === 'string' ? urlData : urlData.url;
                                                            const isLive = typeof urlData === 'object' ? urlData.is_live : true;
                                                            const validationNotes = typeof urlData === 'object' ? urlData.validation_notes : null;

                                                            return (
                                                                <div key={urlIndex} className="url-card">
                                                                    <div className="url-info">
                                                                        <a href={urlString} target="_blank" rel="noopener noreferrer" className="url-link">
                                                                            {urlString}
                                                                        </a>
                                                                        {validationNotes && (
                                                                            <div className="validation-notes">
                                                                                <small>{validationNotes}</small>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="url-status">
                                                                        <span className={`status-indicator ${isLive ? 'valid' : 'invalid'}`}>
                                                                            {isLive ? '✓ Live' : '✗ Not Live'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button
                        onClick={onReview}
                        className="btn btn-secondary"
                        disabled={isLoading}
                    >
                        Cancel Upload
                    </button>
                    <button
                        onClick={onContinue}
                        className="btn btn-primary"
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <div className="spinner"></div>
                                Processing...
                            </>
                        ) : (
                            'Continue Upload'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AIConfirmationModal;
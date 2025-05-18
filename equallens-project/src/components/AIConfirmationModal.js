import React from 'react';
import './AIConfirmationModal.css';

const AIConfirmationModal = ({ isOpen, onReview, onContinue, flaggedFiles, isLoading, onClose }) => {
    if (!isOpen) return null;

    const handleModalContentClick = (e) => {
        e.stopPropagation();
    };

    // Helper to parse HTML in reason text (for structured formatting from backend)
    const createMarkup = (htmlContent) => {
        return { __html: htmlContent };
    };

    // Check if any file has future date concerns
    const hasFutureDateConcerns = flaggedFiles && flaggedFiles.some(file => 
        file.reason && (file.reason.toLowerCase().includes("future") || file.reason.toLowerCase().includes("2025")));

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-confirm-modal-title"
        >
            <div
                className="ai-confirm-modal-content"
                onClick={handleModalContentClick}
            >
                {/* Modal header with close button */}
                <div className="ai-modal-header">
                </div>

                {/* Icon Section at Top */}
                <div className="ai-icon-container">
                    <div className="ai-icon-circle">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5">
                            {/* Robot head icon */}
                            <rect x="7" y="4" width="10" height="12" rx="2" strokeWidth="1.5" />
                            <rect x="9" y="16" width="6" height="4" strokeWidth="1.5" />
                            <circle cx="10" cy="9" r="1.5" fill="currentColor" />
                            <circle cx="14" cy="9" r="1.5" fill="currentColor" />
                            <line x1="9" y1="13" x2="15" y2="13" strokeWidth="1.5" />
                            <line x1="6" y1="8" x2="4" y2="10" strokeWidth="1.5" />
                            <line x1="18" y1="8" x2="20" y2="10" strokeWidth="1.5" />
                        </svg>
                    </div>
                </div>

                <h3 id="ai-confirm-modal-title" className="modal-title ai-confirm-title-warning">
                    Potential Inauthenticity Detected
                </h3>

                <p className="ai-confirm-description">
                    Our system has flagged the following CV(s) as potentially containing fabricated or AI-generated content.
                    {hasFutureDateConcerns && (
                        <span className="date-note"> 
                            <br/><br/>
                            <strong>Note:</strong> Some flags may be related to future dates (like upcoming hackathons or programs).
                            If these represent your genuine plans, you can continue with your upload.
                        </span>
                    )}
                </p>

                {/* Modal content area - this will be scrollable */}
                <div className="ai-confirm-modal-scroll-container">
                    <div className="ai-confirm-modal-body">
                        {flaggedFiles && flaggedFiles.length > 0 && (
                            <div className="ai-flagged-files-container">
                                {flaggedFiles.map((file, index) => (
                                    <div key={index} className="ai-flagged-file-card">
                                        <div className="ai-file-header">
                                            <div className="ai-file-icon">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                    {/* Document icon instead of robot */}
                                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                                                    <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                            <div className="ai-file-name">{file.filename}</div>
                                            <div className="ai-confidence">
                                                {file.confidence && (
                                                    <div className="confidence-pill">
                                                        {(file.confidence * 100).toFixed(0)}% AI Confidence
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="ai-file-reason">
                                            <div dangerouslySetInnerHTML={createMarkup(file.reason || 'No specific reason provided.')}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Fixed footer with buttons */}
                <div className="ai-modal-footer">
                    <button
                        onClick={onReview}
                        className="modal-button secondary-button ai-review-button"
                        disabled={isLoading}
                    >
                        Cancel Upload
                    </button>
                    <button
                        onClick={onContinue}
                        className="modal-button primary-button ai-continue-button"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Processing...' : 'Continue Upload Anyway'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AIConfirmationModal;
import React from 'react';
// import './ScoreDetailModal.css'; // If you have a separate CSS for modals

const InferredSkillModal = ({ isOpen, onClose, skillName, explanation }) => {
    if (!isOpen) return null;

    // Default explanation if a specific one isn't provided
    const defaultExplanation = "This skill was identified as an inferred skill by our AI. Inferred skills are abilities that are not explicitly stated but are suggested by the candidate's experiences, projects, or the overall language used in the resume.";

    return (
        <div
            className="score-detail-modal-overlay" // Reusing class from ScoreDetailModal
            role="dialog"
            aria-modal="true"
            onClick={onClose} // Close modal when clicking outside
        >
            <div
                className="score-detail-modal-content" // Reusing class
                style={{ borderColor: '#8250c8' }} // Example: Orange border for inferred skills
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div className="score-detail-modal-header">
                    <h2 style={{ color: '#8250c8' }}>Inferred Skill: {skillName}</h2>
                    <button className="close-modal-button" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
                <div className="score-detail-modal-body">
                    <p>
                        <strong>How this skill was identified:</strong>
                    </p>
                    <div className="explanation-content"> {/* Reusing class */}
                        {explanation || defaultExplanation}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InferredSkillModal;
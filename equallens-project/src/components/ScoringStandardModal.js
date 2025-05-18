import React from 'react';
import './ScoringStandardModal.css';

const ScoringStandardModal = ({ onClose }) => {
    return (
        <div
            className="scoring-standard-modal-overlay"
            role="dialog"
            aria-labelledby="scoring-standard-modal-title"
            aria-modal="true"
            onClick={() => onClose()}
        >
            <div
                className="scoring-standard-modal-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="scoring-standard-modal-header">
                    <h2 id="scoring-standard-modal-title" className="scoring-standard-modal-title">
                        Scoring Standard
                    </h2>
                    <button
                        className="scoring-standard-modal-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="scoring-standard-modal-body">
                    <div className="scoring-standard-section">
                        <h3>Candidate Evaluation Scale</h3>
                        <p className="standard-description">
                            Our evaluation system rates candidates on a scale of 0-10 across multiple criteria.
                            Each score range represents a specific level of candidate qualification.
                        </p>
                        
                        <div className="scoring-range-bar">
                            <div className="range-segment" style={{ backgroundColor: "#F97C6F", flex: "3" }}>
                                0-3
                            </div>
                            <div className="range-segment" style={{ backgroundColor: "#F9B02E", flex: "3" }}>
                                4-6
                            </div>
                            <div className="range-segment" style={{ backgroundColor: "#56C271", flex: "2" }}>
                                7-8
                            </div>
                            <div className="range-segment" style={{ backgroundColor: "#4E92F9", flex: "2" }}>
                                9-10
                            </div>
                        </div>
                        
                        <div className="scoring-label-bar">
                            <div className="label-segment" style={{ flex: "3" }}>
                                Below Expectations
                            </div>
                            <div className="label-segment" style={{ flex: "3" }}>
                                Meets Requirements
                            </div>
                            <div className="label-segment" style={{ flex: "2" }}>
                                Strong Fit
                            </div>
                            <div className="label-segment" style={{ flex: "2" }}>
                                Exceptional Fit
                            </div>
                        </div>
                    </div>
                    
                    <div className="scoring-levels">
                        <div className="scoring-level">
                            <div className="level-header" style={{ backgroundColor: "#F97C6F" }}>
                                <span className="level-range">0-3</span>
                                <span className="level-label">Below Expectations</span>
                            </div>
                            <p className="level-description">
                                Candidate shows significant gaps in skills, experience, or qualifications compared to job requirements. 
                                Major areas of development would be needed to perform effectively in the role.
                            </p>
                        </div>
                        
                        <div className="scoring-level">
                            <div className="level-header" style={{ backgroundColor: "#F9B02E" }}>
                                <span className="level-range">4-6</span>
                                <span className="level-label">Meets Requirements</span>
                            </div>
                            <p className="level-description">
                                Candidate satisfies the minimum qualifications for the position. Has basic skills and experience 
                                needed, with some room for growth and development in role-specific areas.
                            </p>
                        </div>
                        
                        <div className="scoring-level">
                            <div className="level-header" style={{ backgroundColor: "#56C271" }}>
                                <span className="level-range">7-8</span>
                                <span className="level-label">Strong Fit</span>
                            </div>
                            <p className="level-description">
                                Candidate exceeds basic requirements and shows strong potential. Demonstrates solid experience,
                                capabilities, and alignment with the role requirements. Would be a valuable addition to the team.
                            </p>
                        </div>
                        
                        <div className="scoring-level">
                            <div className="level-header" style={{ backgroundColor: "#4E92F9" }}>
                                <span className="level-range">9-10</span>
                                <span className="level-label">Exceptional Fit</span>
                            </div>
                            <p className="level-description">
                                Candidate significantly exceeds expectations across all or most criteria. Demonstrates exceptional 
                                qualifications, extensive experience, and perfect alignment with position requirements.
                            </p>
                        </div>
                    </div>
                    
                    <div className="final-score-explanation">
                        <h4>Overall Score Calculation</h4>
                        <p>
                            The final score (0-100) is calculated as a weighted average of all evaluation criteria based on the 
                            ranking prompt selected. When multiple categories (Skills, Experience, Education) are selected, 
                            each category contributes equally to the final score, with individual criteria weighted within each category.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScoringStandardModal;

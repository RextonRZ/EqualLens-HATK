import React from 'react';
import './InferredSkillModal.css'; // Import the new CSS

const InferredSkillModal = ({ isOpen, onClose, skillName, categoryTitle, explanationDetail }) => {
    if (!isOpen) return null;

    const defaultExplanationObj = {
        explanation: "This skill was identified by our AI. While a direct sentence might not be pinpointed, it's suggested by the candidate's overall experiences and the language used in the resume.",
        evidence_sentence: "",
        highlighted_keywords: []
    };

    const currentDetail = explanationDetail || defaultExplanationObj;
    const { 
        explanation: explanationText, 
        evidence_sentence: evidenceSentence, 
        highlighted_keywords: highlightedKeywords 
    } = currentDetail;

    const renderEvidenceWithHighlights = (sentence, keywords) => {
        if (!sentence || typeof sentence !== 'string') return <p>No specific evidence sentence provided.</p>;
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            // Safely render HTML, converting newlines
            return <span dangerouslySetInnerHTML={{ __html: sentence.replace(/\n/g, "<br />") }} />;
        }

        try {
            // Escape keywords for regex and join with OR
            const escapedKeywords = keywords.map(kw => 
                kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            );
            const regex = new RegExp(`(${escapedKeywords.join('|')})`, 'gi');
            
            const parts = sentence.split(regex);

            return parts.map((part, index) => {
                if (!part) return null; // Skip empty parts that regex split might produce
                const isKeyword = keywords.some(kw => kw.toLowerCase() === part.toLowerCase());
                if (isKeyword) {
                    return <strong key={index} className="highlighted-keyword">{part}</strong>;
                }
                // For non-keyword parts, replace newlines with <br /> before setting HTML
                return <span key={index} dangerouslySetInnerHTML={{ __html: part.replace(/\n/g, "<br />") }} />;
            }).filter(Boolean); // Filter out null parts
        } catch (e) {
            console.error("Error rendering highlights:", e);
            // Fallback to plain text rendering if regex or splitting fails
            return <span dangerouslySetInnerHTML={{ __html: sentence.replace(/\n/g, "<br />") }} />;
        }
    };

    const displayCategory = categoryTitle || "Inferred Skill";

    return (
        <div
            className="score-detail-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="score-detail-modal-content"
                style={{ borderColor: '#8250c8' }} // Purple border
                onClick={(e) => e.stopPropagation()}
            >
                <div className="score-detail-modal-header">
                    <h2 style={{ color: '#5e35b1' }}> {/* Darker Purple Title */}
                        {displayCategory}: <span className="skill-name-emphasis">{skillName}</span>
                    </h2>
                    <button className="close-modal-button" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
                <div className="score-detail-modal-body">
                    <p>
                        <strong>How this skill was identified:</strong>
                    </p>
                    <div className="explanation-content">
                        {explanationText.replace(/\n/g, "\n")} {/* Ensure newlines render, pre-wrap handles it */}
                    </div>

                    {evidenceSentence && evidenceSentence.trim() !== "" && (
                        <div className="evidence-section">
                            <p>
                                <strong>Evidence from Resume:</strong>
                            </p>
                            <div className="evidence-text-container">
                                {renderEvidenceWithHighlights(evidenceSentence, highlightedKeywords)}
                            </div>
                        </div>
                    )}
                     {(!evidenceSentence || evidenceSentence.trim() === "") && explanationText.toLowerCase().includes("subtly implied") && (
                         <div className="evidence-section">
                             <p>
                                <strong>Evidence from Resume:</strong>
                            </p>
                            <div className="evidence-text-container">
                                No direct sentence was pinpointed, but the skill is implied by the broader resume context as described above.
                            </div>
                         </div>
                     )}
                </div>
            </div>
        </div>
    );
};

export default InferredSkillModal;
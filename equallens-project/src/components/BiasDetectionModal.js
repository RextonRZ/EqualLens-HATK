import React from 'react';
import './BiasDetectionModal.css';

// Function to render potentially highlighted text (optional, for showing context)
const renderHighlightedText = (text, biasedTerms) => {
    if (!text || !biasedTerms || biasedTerms.length === 0) {
        return text;
    }
    // Simple highlighting example (replace with more robust logic if needed)
    let highlighted = text;
    biasedTerms.forEach(term => {
        const regex = new RegExp(`\\b(${term})\\b`, 'gi');
        highlighted = highlighted.replace(regex, `<span class="bias-highlight">$1</span>`);
    });
    return <span dangerouslySetInnerHTML={{ __html: highlighted }} />;
};

const BiasDetectionModal = ({ isOpen, onClose, biasResults, biasedTerms }) => {
    if (!isOpen) return null;

    const hasBiasInfo = Object.keys(biasResults || {}).length > 0 ||
                        Object.values(biasedTerms || {}).some(terms => terms.length > 0);

    return (
        <div className="bias-modal-overlay">
            <div className="bias-modal">
                <div className="bias-modal-header">
                    <h2>Potential Bias Detected</h2>
                    <button className="bias-modal-close" onClick={onClose}>×</button>
                </div>
                <div className="bias-modal-content">
                    <div className="bias-warning-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">
                            <path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 100-16 8 8 0 000 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z" 
                                  fill="#F9645F"/>
                        </svg>
                    </div>
                    <p className="bias-message">We've detected potentially biased language in your job posting that may discourage qualified candidates from applying.</p>
                    
                    {hasBiasInfo ? (
                        <div className="bias-results">
                            {Object.entries(biasResults || {}).map(([field, explanation]) => (
                                <div className="bias-category" key={field}>
                                    {/* Capitalize field name for display */}
                                    <h3>{field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</h3>
                                    <p>{explanation}</p>
                                    {/* Optionally show specific biased terms found in this field */}
                                    {biasedTerms && biasedTerms[field] && biasedTerms[field].length > 0 && (
                                        <p><strong>Biased Terms Found:</strong> {biasedTerms[field].join(', ')}</p>
                                    )}
                                </div>
                            ))}
                             {/* Display fields that only have biased terms but no explanation */}
                             {Object.entries(biasedTerms || {}).map(([field, terms]) => {
                                 // Only show if there's no explanation already shown for this field
                                 if (!(biasResults && biasResults[field]) && terms && terms.length > 0) {
                                     return (
                                         <div className="bias-category" key={`${field}-terms`}>
                                             <h3>{field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</h3>
                                             <p><strong>Biased Terms Found:</strong> {terms.join(', ')}</p>
                                         </div>
                                     );
                                 }
                                 return null;
                             })}
                        </div>
                    ) : (
                         <p>No specific biased fields identified, but the overall check indicated potential issues. Please review your posting carefully.</p>
                    )}
                </div>
                <div className="bias-modal-footer">
                    <button className="bias-action-button" onClick={onClose}>
                        Edit Job Posting
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BiasDetectionModal;
import React, { useState } from 'react';

const InfoTooltip = ({ content }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="info-tooltip-container">
      <button 
        className="info-tooltip-trigger" 
        onClick={() => setShowTooltip(true)}
        aria-label="More information"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
          <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533L8.93 6.588zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
        </svg>
      </button>
      
      {showTooltip && (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
          <div className="status-modal info-modal">
            <div className="status-icon info-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2196f3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18h6"></path>
                <path d="M10 22h4"></path>
                <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z" fill="#e3f2fd"></path>
            </svg>
            </div>
            <h3 className="status-title">AI Auto-Filled Skills</h3>
            <p className="status-description">
              Skills marked with "(AI)" were inferred from the candidate's experience, projects, and education details.
              <br /><br />
              This helps ensure all candidates are evaluated fairly, even when they don't explicitly list all their skills.
            </p>
            <div className="status-buttons">
              <button className="status-button primary-button" onClick={() => setShowTooltip(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InfoTooltip;

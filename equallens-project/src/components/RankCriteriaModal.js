import React from 'react';
import RankCriteriaContent from './RankCriteriaContent';
import './RankCriteriaModal.css';

const RankCriteriaModal = ({ isOpen, onClose, prompt }) => {
    if (!isOpen) return null;
    
    return (
        <div className="modal-overlay">
            <div className="modal-content rank-criteria-modal">
                <div className="modal-header">
                    <h2 className="modal-title">Ranking Criteria Details</h2>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>
                <div className="modal-body">
                    <RankCriteriaContent prompt={prompt} />
                </div>
                <div className="modal-footer">
                    <button className="modal-button" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default RankCriteriaModal;
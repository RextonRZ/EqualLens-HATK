// src/components/JobSuggestionModal.js
import React, { useState, useEffect } from 'react';
import './JobSuggestionModal.css'; // Create this CSS file

const JobSuggestionModal = ({ isOpen, onClose, onSubmit, jobTitle, isLoading }) => {
    const [context, setContext] = useState({
        core_responsibilities: "",
        key_skills: "",
        company_culture: "",
        experience_level: ""
    });

    // Reset context when modal opens
    useEffect(() => {
        if (isOpen) {
            setContext({
                core_responsibilities: "",
                key_skills: "",
                company_culture: "",
                experience_level: ""
            });
        }
    }, [isOpen]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setContext(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(context); // Pass the context data up
    };

    if (!isOpen) return null;

    return (
        <div className="suggestion-modal-overlay">
            <div className="suggestion-modal">
                <h3 className="suggestion-modal-title">Generate Job Details Suggestions</h3>
                <p className="suggestion-modal-subtitle">
                    Provide some context about the <strong>{jobTitle || 'job'}</strong> to help generate relevant suggestions.
                </p>
                <form onSubmit={handleSubmit}>
                    <div className="suggestion-form-group">
                        <label htmlFor="core_responsibilities">Core Responsibilities (Optional)</label>
                        <textarea
                            id="core_responsibilities"
                            name="core_responsibilities"
                            value={context.core_responsibilities}
                            onChange={handleChange}
                            placeholder="e.g., Develop new features, manage client relationships, analyze data..."
                            rows="3"
                        />
                    </div>
                    <div className="suggestion-form-group">
                        <label htmlFor="key_skills">Key Skills Needed (Optional)</label>
                        <input
                            type="text"
                            id="key_skills"
                            name="key_skills"
                            value={context.key_skills}
                            onChange={handleChange}
                            placeholder="e.g., React, Python, Project Management, Communication"
                        />
                    </div>
                    <div className="suggestion-form-group">
                        <label htmlFor="company_culture">Company Culture/Values (Optional)</label>
                        <input
                            type="text"
                            id="company_culture"
                            name="company_culture"
                            value={context.company_culture}
                            onChange={handleChange}
                            placeholder="e.g., Fast-paced startup, collaborative team, focus on innovation"
                        />
                    </div>
                    <div className="suggestion-form-group">
                        <label htmlFor="experience_level">Desired Experience Level (Optional)</label>
                        <select
                            id="experience_level"
                            name="experience_level"
                            value={context.experience_level}
                            onChange={handleChange}
                        >
                            <option value="">Select Level</option>
                            <option value="Entry-level">Entry-level</option>
                            <option value="Junior">Junior</option>
                            <option value="Mid-level">Mid-level</option>
                            <option value="Senior">Senior</option>
                            <option value="Lead/Principal">Lead/Principal</option>
                        </select>
                    </div>
                    <div className="suggestion-modal-actions">
                        <button type="button" onClick={onClose} className="suggestion-cancel-button" disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" className="suggestion-generate-button" disabled={isLoading || !jobTitle}>
                            {isLoading ? 'Generating...' : 'Generate Suggestions'}
                        </button>
                    </div>
                     {!jobTitle && <p className="suggestion-warning">Please enter a Job Title first.</p>}
                </form>
            </div>
        </div>
    );
};

export default JobSuggestionModal;
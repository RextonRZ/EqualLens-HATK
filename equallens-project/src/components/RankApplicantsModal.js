import React, { useState, useEffect } from "react";
import "./RankApplicantsModal.css"; // Ensure this CSS file includes styles for the custom checkbox

const RankApplicantsModal = ({ isOpen, onClose, jobId, jobTitle, onSubmit, currentPrompt }) => {
    const [selectedOptions, setSelectedOptions] = useState([]);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showMissingModal, setShowMissingModal] = useState(false);
    const [expandedCriteria, setExpandedCriteria] = useState(null);

    // Parse current prompt and pre-select checkboxes based on it
    useEffect(() => {
        if (currentPrompt) {
            const newSelectedOptions = [];
            const promptLower = currentPrompt.toLowerCase();

            // Check for each criteria in the prompt
            if (promptLower.includes("skill")) {
                newSelectedOptions.push("Skills");
            }
            if (promptLower.includes("experience")) {
                newSelectedOptions.push("Experience");
            }
            if (promptLower.includes("education")) {
                newSelectedOptions.push("Education");
            }
            if (promptLower.includes("cultural fit")) {
                newSelectedOptions.push("Cultural Fit");
            }

            setSelectedOptions(newSelectedOptions);
        }
    }, [currentPrompt]);

    // Hide body scrolling when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'visible';
        }

        return () => {
            document.body.style.overflow = 'visible';
        };
    }, [isOpen]);

    const handleCheckboxChange = (option) => {
        if (selectedOptions.includes(option)) {
            // Remove the option if already selected
            setSelectedOptions(selectedOptions.filter((item) => item !== option));
        } else if (selectedOptions.length < 4) {
            // Add the option if not already selected and limit is not exceeded
            setSelectedOptions([...selectedOptions, option]);
        }
    };

    // Function to toggle the expanded criteria
    const toggleExpand = (criteria) => {
        if (expandedCriteria === criteria) {
            // If already expanded, collapse it
            setExpandedCriteria(null);
        } else {
            // Otherwise, expand this criteria and collapse any other
            setExpandedCriteria(criteria);
        }
    };

    // Subcriteria descriptions
    const criteriaDetails = {
        Skills: [
            { title: "Relevance to Job", description: "Evaluate how well the candidate's skills match the job description." },
            { title: "Proficiency", description: "Assess the candidate's level of skill proficiency which would benefit the job description." },
            { title: "Additional Skills", description: "Identify additional skills the candidate has that are not listed in the job description." }
        ],
        Experience: [
            { title: "Job Experience", description: "Evaluate the alignment of the candidate's previous job experience with the job description." },
            { title: "Projects & Co-curricular", description: "Assess the relevance of the candidate's projects and co-curricular activities that relates to the job." },
            { title: "Certifications", description: "Evaluate the certifications and training the candidate has completed which would benefit the job description." }
        ],
        Education: [
            { title: "Level of Study", description: "Assess the candidate's level of study and education." },
            { title: "Awards & Achievements", description: "Evaluate the candidate's awards and achievements which would benefit the job description." },
            { title: "Relevant Coursework", description: "Assess the relevance of the candidate's coursework and research that relates to the job." }
        ],
        "Cultural Fit": [
            { title: "Collaboration Style", description: "Evaluate how well the candidate demonstrates the ability to work with others, such as leadership roles, teamwork, or group project experience." },
            { title: "Growth Mindset", description: "Assess the candidate's willingness to learn, improve, and adapt through certifications, awards, or self-initiated learning." },
            { title: "Community Engagement", description: "Evaluate the candidate's involvement in community, volunteering, or organizational activities that showcase cultural adaptability and inclusive contributions." }
        ]
    };

    const handleSubmit = () => {
        if (selectedOptions.length > 0) {
            // Combine selected options into a string and pass to parent
            const prompt = selectedOptions.join(", ");
            onSubmit(prompt);

            // Reset state and close modal
            setSelectedOptions([]);
            onClose();
        } else {
            // Show missing modal if no options are selected
            setShowMissingModal(true);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            role="dialog"
            aria-labelledby="modal-title"
            aria-modal="true"
        >
            <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="rank-modal-header">
                    <h2 id="modal-title" className="modal-title">
                        Rank Applicants for {jobTitle}
                    </h2>
                    <button
                        className="modal-close"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                <div className="rank-modal-description">
                    <div className="label-container" >
                        <div className="label-row">Choose up to 4 criteria to rank the applicants for this job:
                        </div>
                    </div>
                </div>

                <div className="rank-modal-body">
                    {["Skills", "Experience", "Education", "Cultural Fit"].map((criteria, index) => (
                        <div
                            key={criteria}
                            className={`criteria-container ${expandedCriteria === criteria ? 'expanded' : ''}`}
                            data-criteria={criteria}
                        >
                            <div className="criteria-row">
                                <div
                                    className="label-row clickable"
                                    onClick={() => toggleExpand(criteria)}
                                >
                                    <span>{criteria}</span>
                                </div>
                                <div className="checkbox-wrapper-26">
                                    <input
                                        type="checkbox"
                                        id={`${criteria.toLowerCase().replace(' ', '-')}-checkbox`}
                                        checked={selectedOptions.includes(criteria)}
                                        onChange={() => handleCheckboxChange(criteria)}
                                    />
                                    <label htmlFor={`${criteria.toLowerCase().replace(' ', '-')}-checkbox`}>
                                        <div className="tick_mark"></div>
                                    </label>
                                </div>
                            </div>

                            {expandedCriteria === criteria && (
                                <div className="criteria-details">
                                    {criteriaDetails[criteria].map((detail, i) => (
                                        <div key={i} className="subcriteria-item">
                                            <span className="subcriteria-title">{detail.title}:</span>
                                            <span className="subcriteria-description">{detail.description}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="rank-modal-footer">
                    <button
                        className="modal-button secondary-button"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        className="modal-button primary-button"
                        onClick={handleSubmit}
                        disabled={selectedOptions.length === 0}
                    >
                        Submit
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RankApplicantsModal;
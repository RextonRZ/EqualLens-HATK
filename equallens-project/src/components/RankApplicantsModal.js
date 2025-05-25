import React, { useState, useEffect } from "react";
import "./RankApplicantsModal.css"; // Ensure this CSS file includes styles for the custom checkbox

const RankApplicantsModal = ({ isOpen, onClose, jobId, jobTitle, onSubmit, currentPrompt }) => {
    const [selectedOptions, setSelectedOptions] = useState([]);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showMissingModal, setShowMissingModal] = useState(false);

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
            onClick={() => setShowConfirmModal(true)}
            role="dialog"
            aria-labelledby="modal-title"
            aria-modal="true"
        >
            <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
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
                    <div className="label-container">
                        <div className="label-row" style={{ marginLeft: "1rem" }}>Skills</div>
                        <div className="label-row" style={{ marginLeft: "1rem" }}>Experience</div>
                        <div className="label-row" style={{ marginLeft: "1rem" }}>Education</div>
                        <div className="label-row" style={{ marginLeft: "1rem" }}>Cultural Fit</div>
                    </div>
                    <div className="checkbox-container">
                        <div className="checkbox-wrapper-26" style={{ marginRight: "0.5rem" }}>
                            <input
                                type="checkbox"
                                id="skills-checkbox"
                                checked={selectedOptions.includes("Skills")}
                                onChange={() => handleCheckboxChange("Skills")}
                            />
                            <label htmlFor="skills-checkbox">
                                <div className="tick_mark"></div>
                            </label>
                        </div>
                        <div className="checkbox-wrapper-26" style={{ marginRight: "0.5rem" }}>
                            <input
                                type="checkbox"
                                id="experience-checkbox"
                                checked={selectedOptions.includes("Experience")}
                                onChange={() => handleCheckboxChange("Experience")}
                            />
                            <label htmlFor="experience-checkbox">
                                <div className="tick_mark"></div>
                            </label>
                        </div>
                        <div className="checkbox-wrapper-26" style={{ marginRight: "0.5rem" }}>
                            <input
                                type="checkbox"
                                id="education-checkbox"
                                checked={selectedOptions.includes("Education")}
                                onChange={() => handleCheckboxChange("Education")}
                            />
                            <label htmlFor="education-checkbox">
                                <div className="tick_mark"></div>
                            </label>
                        </div>
                        <div className="checkbox-wrapper-26" style={{ marginRight: "0.5rem", marginBottom: "1rem" }}>
                            <input
                                type="checkbox"
                                id="culturalfit-checkbox"
                                checked={selectedOptions.includes("Cultural Fit")}
                                onChange={() => handleCheckboxChange("Cultural Fit")}
                            />
                            <label htmlFor="culturalfit-checkbox">
                                <div className="tick_mark"></div>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="modal-footer">
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
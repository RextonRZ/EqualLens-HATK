import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./AddInterviewQuestions.css";
import '../pageloading.css'; // Import the loading animation CSS
import axios from 'axios'; // Add axios for API calls
import CandidateProfileModal from '../CandidateProfileModal'; // Corrected import path

// Add LoadingAnimation component for consistency
const LoadingAnimation = () => {
    return (
        <div className="loading-animation">
            <div className="seesaw-container">
                <div className="bar"></div>
                <div className="ball"></div>
            </div>
        </div>
    );
};

// Add a new component for the typing animation
const TypingAnimation = ({ sectionTitle }) => {
    return (
        <div className="question-typing-animation">
            <div className="typing-header">
                <strong>Generating question for {sectionTitle}</strong>
            </div>
            <div className="typing-content">
                <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <span style={{ marginLeft: '8px' }}>EqualLens AI is crafting a question...</span>
            </div>
        </div>
    );
};

const AddInterviewQuestions = () => {
    const [sections, setSections] = useState([]);
    const [newSectionTitle, setNewSectionTitle] = useState("");
    const [jobDetails, setJobDetails] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [isNavigatingBack, setIsNavigatingBack] = useState(false);
    const [applicants, setApplicants] = useState([]);
    const [selectedApplicant, setSelectedApplicant] = useState("");
    const [isLoadingApplicants, setIsLoadingApplicants] = useState(false);
    const [editingSectionIndex, setEditingSectionIndex] = useState(null);
    const [editedSectionTitle, setEditedSectionTitle] = useState("");
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [sectionToDelete, setSectionToDelete] = useState(null);
    const [showSaveConfirmModal, setShowSaveConfirmModal] = useState(false);
    const [totalInterviewTime, setTotalInterviewTime] = useState({ minutes: 0, seconds: 0 });
    const [showNavigationModal, setShowNavigationModal] = useState(false);
    const [aiGenerateUsedMap, setAiGenerateUsedMap] = useState({});
    const [showAISuccess, setShowAISuccess] = useState(false);
    const [changesSaved, setChangesSaved] = useState(true);
    const [sectionsLoadedFromDB, setSectionsLoadedFromDB] = useState(false);
    const [showApplyToAllModal, setShowApplyToAllModal] = useState(false);
    const [applyToAllStatus, setApplyToAllStatus] = useState(null);
    const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
    const [showResetSuccessModal, setShowResetSuccessModal] = useState(false);
    const [loadingOperation, setLoadingOperation] = useState("Loading"); // Changed from "Saving" to "Loading"
    const [showCandidateSwitchModal, setShowCandidateSwitchModal] = useState(false);
    const [pendingCandidateId, setPendingCandidateId] = useState(null);
    const [showUnsavedResetModal, setShowUnsavedResetModal] = useState(false);
    const [initialSections, setInitialSections] = useState([]);
    const [aiGeneratedUnsaved, setAiGeneratedUnsaved] = useState(false);
    const [showAIConfirmModal, setShowAIConfirmModal] = useState(false);
    const [generatingQuestionForSection, setGeneratingQuestionForSection] = useState(null);
    const [expandedSections, setExpandedSections] = useState({});
    const [showCandidateProfileModal, setShowCandidateProfileModal] = useState(false);
    const [viewingCandidateId, setViewingCandidateId] = useState(null);

    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const jobId = queryParams.get('jobId');
    const navigate = useNavigate();

    const initialCandidateIdRef = useRef(null);

    // 1. Read the candidateId from query ONCE on mount
    useEffect(() => {
        initialCandidateIdRef.current = queryParams.get('candidateId');
        if (initialCandidateIdRef.current) {
            console.log(`Found candidateId in URL: ${initialCandidateIdRef.current}`);
        }
    }, []); // Empty dependency array - runs only on mount

    useEffect(() => {
        const fetchJobDetails = async () => {
            if (!jobId) return;

            setIsLoading(true);
            try {
                const response = await fetch(`http://localhost:8000/api/jobs/${jobId}`);
                if (!response.ok) {
                    throw new Error("Failed to fetch job details");
                }
                const data = await response.json();
                setJobDetails(data);
            } catch (error) {
                console.error("Error fetching job details:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchJobDetails();
    }, [jobId]);

    useEffect(() => {
        const fetchApplicants = async () => {
            if (!jobId) return;

            setIsLoadingApplicants(true);
            try {
                const response = await fetch(`http://localhost:8000/api/candidates/applicants?jobId=${jobId}`);
                if (!response.ok) {
                    throw new Error("Failed to fetch applicants");
                }
                const data = await response.json();
                setApplicants(data);

                // Now that applicants are loaded, check if we have an initial ID
                if (initialCandidateIdRef.current) {
                    // Check if the ID exists in the fetched list
                    const candidateExists = data.some(app => app.candidateId === initialCandidateIdRef.current);
                    if (candidateExists) {
                        console.log(`Setting selected applicant from URL: ${initialCandidateIdRef.current}`);
                        setSelectedApplicant(initialCandidateIdRef.current);
                    } else {
                        console.warn(`Candidate ID ${initialCandidateIdRef.current} from URL not found in applicants list.`);
                        // Optionally clear the ref or handle the error
                    }
                    // Clear the ref so this doesn't run again on subsequent fetches
                    initialCandidateIdRef.current = null;
                }
            } catch (error) {
                console.error("Error fetching applicants:", error);
            } finally {
                setIsLoadingApplicants(false);
            }
        };

        fetchApplicants();
    }, [jobId]);

    const resetUI = (keepSelectedApplicant = false) => {
        setSections([]);
        setNewSectionTitle("");
        if (!keepSelectedApplicant) {
            setSelectedApplicant("");
        } else if (selectedApplicant) {
            setAiGenerateUsedMap(prev => {
                const newMap = {...prev};
                delete newMap[selectedApplicant];
                return newMap;
            });
        }
        setEditingSectionIndex(null);
        setEditedSectionTitle("");
        setShowErrorModal(false);
        setErrorMessage("");
        setShowConfirmModal(false);
        setAiGeneratedUnsaved(false);
    };

    useEffect(() => {
        const fetchSavedQuestions = async () => {
             // Check if selectedApplicant is actually set before proceeding
            if (!jobId || !selectedApplicant || selectedApplicant === "all") {
                 // Reset only if we are NOT loading questions (avoid race condition)
                if (!isLoadingApplicants) {
                   resetUI(selectedApplicant === "all"); // Pass true to keep 'all' selected if needed
                }
                return;
            }

            // Add a small delay or check loading state ---
            if (isLoadingApplicants) {
                console.log("Waiting for applicants to load before fetching questions...");
                return;
            }

            try {
                const response = await axios.get(
                    `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
                );
                const data = response.data;
                if (data) {
                    setSections(data.sections);
                    setSectionsLoadedFromDB(true);
                    setChangesSaved(true);
                }
            } catch (error) {
                console.error("Error fetching saved questions:", error);

                if (error.response && error.response.status === 404) {
                     console.log("No question set found for this applicant. Starting with a blank slate.");
                     // Reset sections, but KEEP selectedApplicant
                     setSections([]);
                     setInitialSections([]);
                     setChangesSaved(true); // Start fresh, so it's "saved"
                     setAiGenerateUsedMap(prev => {
                         const newMap = {...prev};
                         delete newMap[selectedApplicant];
                         return newMap;
                     });
                 } else {
                     setErrorMessage(`Error loading questions: ${error.message}`);
                     setShowErrorModal(true);
                 }
            }
        };

        fetchSavedQuestions();
    }, [jobId, selectedApplicant, isLoadingApplicants]);

    useEffect(() => {
        const fetchSavedQuestions = async () => {
            if (!jobId || !selectedApplicant) {
                resetUI();
                return;
            }

            if (selectedApplicant === "all") {
                setSections([]);
                setSectionsLoadedFromDB(true);
                setChangesSaved(true);
                setInitialSections([]);
                return;
            }

            setSections([]);

            try {
                const response = await axios.get(
                    `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
                );
                const data = response.data;
                if (data) {
                    const processedSections = data.sections.map(section => ({
                        ...section,
                        questions: section.questions.map(question => {
                            const processedQuestion = { ...question };
                            if (processedQuestion.isAIGenerated && processedQuestion.isAIModified) {
                                processedQuestion.isAIModified = true;
                            }
                            if (!processedQuestion.isAIGenerated && !processedQuestion.originalText) {
                                processedQuestion.originalText = "";
                            }
                            return processedQuestion;
                        })
                    }));

                    setSections(processedSections);
                    setInitialSections(JSON.parse(JSON.stringify(processedSections)));

                    if (data.aiGenerationUsed) {
                        setAiGenerateUsedMap(prev => ({
                            ...prev,
                            [selectedApplicant]: true
                        }));
                    }
                } else {
                    setSections([]);
                    setInitialSections([]);
                }
            } catch (error) {
                console.error("Error fetching saved questions:", error);

                if (error.response && error.response.status === 404) {
                    console.log("No question set found for this applicant. Starting with a blank slate.");
                    setSections([]);
                    setInitialSections([]);

                    setAiGenerateUsedMap(prev => {
                        const newMap = {...prev};
                        delete newMap[selectedApplicant];
                        return newMap;
                    });
                } else {
                    setErrorMessage(`Error loading questions: ${error.message}`);
                    setShowErrorModal(true);
                }
            }
        };

        fetchSavedQuestions();
    }, [jobId, selectedApplicant]);

    useEffect(() => {
        const areSectionsEqual = (sectionsA, sectionsB) => {
            try {
                if (!sectionsA && !sectionsB) return true;
                if (!sectionsA || !sectionsB) return false;
                
                if (sectionsA.length !== sectionsB.length) return false;
                
                if (sectionsA.length === 0 && sectionsB.length === 0) return true;
                
                for (let i = 0; i < sectionsA.length; i++) {
                    const sectionA = sectionsA[i];
                    const sectionB = sectionsB[i];
                    
                    if (sectionA.title !== sectionB.title) return false;
                    if (sectionA.randomSettings?.enabled !== sectionB.randomSettings?.enabled) return false;
                    if (sectionA.randomSettings?.enabled && 
                        sectionA.randomSettings?.count !== sectionB.randomSettings?.count) return false;
                    
                    if (sectionA.questions.length !== sectionB.questions.length) return false;
                    
                    for (let j = 0; j < sectionA.questions.length; j++) {
                        const questionA = sectionA.questions[j];
                        const questionB = sectionsB[i].questions[j];
                        
                        if (questionA.text !== questionB.text) return false;
                        if (questionA.timeLimit !== questionB.timeLimit) return false;
                        if (questionA.isCompulsory !== questionB.isCompulsory) return false;
                    }
                }
                
                return true;
            } catch (error) {
                console.error("Error comparing sections:", error);
                return false;
            }
        };

        if (!sectionsLoadedFromDB) {
            const sectionsJSON = JSON.stringify(sections);
            const initialSectionsJSON = JSON.stringify(initialSections);
            
            const hasChanges = sectionsJSON !== initialSectionsJSON;
            
            if (changesSaved === hasChanges) {
                setChangesSaved(!hasChanges);
            }
        } else {
            setSectionsLoadedFromDB(false);
        }
    }, [sections, initialSections, sectionsLoadedFromDB, changesSaved]);

    useEffect(() => {
        setAiGenerateUsedMap({});
    }, []);

    useEffect(() => {
        return () => {
            setAiGeneratedUnsaved(false);
        };
    }, [selectedApplicant]);

    const handleAddSection = () => {
        if (newSectionTitle.trim()) {
            const newSection = { 
                title: newSectionTitle, 
                questions: [{ 
                    text: "", 
                    timeLimit: 60,
                    isCompulsory: true,
                    isAIModified: false,  // Explicitly set to false
                    originalText: null    // Set to null to indicate it's a brand new question
                }],
                randomSettings: {
                    enabled: false,
                    count: 0
                }
            };
            
            setSections([...sections, newSection]);
            setNewSectionTitle("");
        }
    };

    const handleRemoveSection = (sectionIndex) => {
        if (sections[sectionIndex].questions.length > 0) {
            setSectionToDelete(sectionIndex);
            setShowConfirmModal(true);
        } else {
            removeSection(sectionIndex);
        }
    };

    const removeSection = (sectionIndex) => {
        const updatedSections = [...sections];
        updatedSections.splice(sectionIndex, 1);
        setSections(updatedSections);
    };

    const handleConfirmCandidateSwitch = () => {
        setShowCandidateSwitchModal(false);
        setSelectedApplicant(pendingCandidateId);
        setPendingCandidateId(null);
    };

    const handleCancelCandidateSwitch = () => {
        setShowCandidateSwitchModal(false);
        setPendingCandidateId(null);
        setShowSaveConfirmModal(true);
    };

    const handleApplicantChange = (e) => {
        const newValue = e.target.value;
        
        if (!changesSaved && sections.length > 0 && selectedApplicant) {
            const sectionsJSON = JSON.stringify(sections);
            const initialSectionsJSON = JSON.stringify(initialSections);
            
            if (sectionsJSON !== initialSectionsJSON) {
                setPendingCandidateId(newValue);
                setShowCandidateSwitchModal(true);
            } else {
                setSelectedApplicant(newValue);
                setChangesSaved(true);
            }
        } else {
            setSelectedApplicant(newValue);
        }
    };

    const handleConfirmSectionDelete = () => {
        if (sectionToDelete !== null) {
            removeSection(sectionToDelete);
            setSectionToDelete(null);
        }
        setShowConfirmModal(false);
    };

    const handleCancelSectionDelete = () => {
        setSectionToDelete(null);
        setShowConfirmModal(false);
    };

    const handleAddQuestion = (sectionIndex) => {
        const updatedSections = [...sections];
        const newQuestion = { 
            text: "", 
            timeLimit: 60,  // Change default to 60 seconds
            isCompulsory: true,
            isAIModified: false,
            originalText: null  // Set to null to indicate it's a brand new question
        };

        updatedSections[sectionIndex].questions.push(newQuestion);
        setSections(updatedSections);
    };

    const handleQuestionChange = (sectionIndex, questionIndex, value) => {
        const updatedSections = [...sections];
        const question = updatedSections[sectionIndex].questions[questionIndex];
        
        // Brand new question (originalText is null)
        if (question.originalText === null) {
            // Don't set any modified flags for brand new questions
            question.text = value;
            // We'll set originalText when saving, not during editing
            setSections(updatedSections);
            return;
        }
        
        // Store original text if this is first edit
        if (!question.originalText) {
            question.originalText = question.text;
        }
        
        // Update the text value
        question.text = value;
        
        // Now determine if the question should be marked as modified by checking ALL properties
        updateModificationStatus(question);
        
        setSections(updatedSections);
    };
    
    const handleQuestionTimeChange = (sectionIndex, questionIndex, value) => {
        const updatedSections = [...sections];
        const timeLimit = Math.max(1, parseInt(value) || 0);
        const question = updatedSections[sectionIndex].questions[questionIndex];
        
        // For brand new questions, just update the value without modification flags
        if (question.originalText === null) {
            question.timeLimit = timeLimit;
            setSections(updatedSections);
            return;
        }
        
        // First time changing time limit, store the original value
        if (question.isAIGenerated && !question.originalTimeLimit) {
            question.originalTimeLimit = question.timeLimit;
        } else if (!question.originalTimeLimit) {
            question.originalTimeLimit = question.timeLimit;
        }
        
        // Update the time limit value
        question.timeLimit = timeLimit;
        
        // Now determine if the question should be marked as modified by checking ALL properties
        updateModificationStatus(question);
        
        setSections(updatedSections);
    };

    const handleQuestionCompulsoryChange = (sectionIndex, questionIndex, isCompulsory) => {
        const updatedSections = [...sections];
        const question = updatedSections[sectionIndex].questions[questionIndex];
        
        // For brand new questions, just update without modification flags
        if (question.originalText === null) {
            question.isCompulsory = isCompulsory;
        } else {
            // First time changing compulsory, store the original value
            if (!question.hasOwnProperty('originalCompulsory')) {
                question.originalCompulsory = question.isCompulsory;
            }
            
            // Update the compulsory value
            question.isCompulsory = isCompulsory;
            
            // Now determine if the question should be marked as modified
            updateModificationStatus(question);
        }
        
        // Count non-compulsory questions after the change
        const nonCompulsoryCount = updatedSections[sectionIndex].questions.filter(q => !q.isCompulsory).length;
        
        // Auto-disable random selection if we have fewer than 2 non-compulsory questions
        if (isCompulsory && nonCompulsoryCount < 2 && updatedSections[sectionIndex].randomSettings.enabled) {
            updatedSections[sectionIndex].randomSettings.enabled = false;
        }
        
        // Auto-enable random selection if we have 2+ non-compulsory questions
        if (!isCompulsory && nonCompulsoryCount >= 2) {
            updatedSections[sectionIndex].randomSettings.enabled = true;
            const maxAllowed = Math.max(1, nonCompulsoryCount - 1);
            const defaultCount = Math.min(Math.floor(nonCompulsoryCount / 2), maxAllowed);
            updatedSections[sectionIndex].randomSettings.count = Math.max(1, defaultCount);
        }
        
        setSections(updatedSections);
    };
    
    const updateModificationStatus = (question) => {
        // Skip for brand new questions
        if (question.originalText === null) return;
        
        if (question.isAIGenerated) {
            // For AI-generated questions, always compare with the original AI text
            // We never update originalText for AI questions, only check if current text matches it
            const textMatches = question.text === question.originalText;
            const timeLimitMatches = !question.originalTimeLimit || question.timeLimit === question.originalTimeLimit;
            const compulsoryMatches = !question.hasOwnProperty('originalCompulsory') || 
                                      question.isCompulsory === question.originalCompulsory;
            
            // Modified if ANY property doesn't match original AI values
            question.isAIModified = !(textMatches && timeLimitMatches && compulsoryMatches);
        } else {
            // For regular questions
            // Check if text matches original (if we have an original)
            const textMatches = !question.originalText || question.text === question.originalText;
            
            // Check if time limit matches original (if we have an original)
            const timeLimitMatches = !question.originalTimeLimit || question.timeLimit === question.originalTimeLimit;
            
            // Check if compulsory matches original (if we have an original)
            const compulsoryMatches = !question.hasOwnProperty('originalCompulsory') || 
                                      question.isCompulsory === question.originalCompulsory;
            
            // Only if ALL properties match their originals, the question is unmodified
            if (textMatches && timeLimitMatches && compulsoryMatches) {
                question.isAIModified = false;
            } else {
                question.isAIModified = true;
            }
        }
    };

    const handleSectionRandomSettingsChange = (sectionIndex, enabled) => {
        const updatedSections = [...sections];
        const nonCompulsoryCount = updatedSections[sectionIndex].questions.filter(q => !q.isCompulsory).length;
        
        if (enabled && nonCompulsoryCount < 2) {
            setErrorMessage(
                `Please ensure you have at least 2 non-compulsory questions in order to enable random selection.
                The ${updatedSections[sectionIndex].title} section only has ${nonCompulsoryCount} non-compulsory question${nonCompulsoryCount === 1 ? '' : 's'}.`
            );
            setShowErrorModal(true);
            return;
        }
        
        updatedSections[sectionIndex].randomSettings.enabled = enabled;
        
        if (enabled) {
            // Special case for exactly 2 non-compulsory questions - always set count to 1
            if (nonCompulsoryCount === 2) {
                updatedSections[sectionIndex].randomSettings.count = 1;
            } else {
                const maxAllowed = Math.max(1, nonCompulsoryCount - 1);
                const defaultCount = Math.min(Math.floor(nonCompulsoryCount / 2), maxAllowed);
                updatedSections[sectionIndex].randomSettings.count = Math.max(1, defaultCount);
            }
        } else {
            updatedSections[sectionIndex].questions = updatedSections[sectionIndex].questions.map(question => {
                const updatedQuestion = { ...question };
                
                if (!question.isCompulsory) {
                    if (question.isAIGenerated && !question.hasOwnProperty('originalCompulsory')) {
                        updatedQuestion.originalCompulsory = question.isCompulsory;
                    }
                    
                    if (question.isAIGenerated) {
                        updatedQuestion.isAIModified = true;
                    }
                    
                    updatedQuestion.isCompulsory = true;
                }
                
                return updatedQuestion;
            });
        }
        
        setSections(updatedSections);
    };

    const handleRandomCountChange = (sectionIndex, count) => {
        const updatedSections = [...sections];
        const nonCompulsoryCount = updatedSections[sectionIndex].questions.filter(q => !q.isCompulsory).length;
        
        const parsedCount = parseInt(count) || 0;
        const maxAllowed = Math.max(1, nonCompulsoryCount - 1);
        const validCount = Math.min(parsedCount, maxAllowed);
        
        updatedSections[sectionIndex].randomSettings.count = validCount;
        updatedSections[sectionIndex].randomSettings.isCountValid = validCount > 0 && validCount <= maxAllowed;
        
        setSections(updatedSections);
    };

    const handleRemoveQuestion = (sectionIndex, questionIndex) => {
        const updatedSections = [...sections];
        
        const isNonCompulsory = !updatedSections[sectionIndex].questions[questionIndex].isCompulsory;
        
        updatedSections[sectionIndex].questions.splice(questionIndex, 1);
        
        if (isNonCompulsory) {
            const remainingNonCompulsoryCount = updatedSections[sectionIndex].questions.filter(q => !q.isCompulsory).length;
            
            if (remainingNonCompulsoryCount < 2 && updatedSections[sectionIndex].randomSettings.enabled) {
                updatedSections[sectionIndex].randomSettings.enabled = false;
            }
        }
        
        setSections(updatedSections);
    };

    const handleViewProfile = () => {
        if (!selectedApplicant) {
            setErrorMessage("Please select an applicant or 'Apply to All' to generate questions for.");
            setShowErrorModal(true);
            return;
        }
        
        setViewingCandidateId(selectedApplicant);
        setShowCandidateProfileModal(true);
    };

    const validateSections = () => {
        if (sections.length === 0) {
            setErrorMessage(
                "No interview question sections added yet. Please add at least one section with questions before saving."
            );
            setShowErrorModal(true);
            return false;
        }
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.questions.length === 0) {
                setErrorMessage(
                    `The "${section.title}" section has no questions. Please add at least one question to each section or remove empty sections.`
                );
                setShowErrorModal(true);
                return false;
            }
            
            for (let j = 0; j < section.questions.length; j++) {
                if (!section.questions[j].text.trim()) {
                    setErrorMessage(
                        `Please fill in all question fields. There is an empty question in the "${section.title}" section.`
                    );
                    setShowErrorModal(true);
                    return false;
                }
            }
            
            // Check for non-compulsory questions without random selection
            const nonCompulsoryCount = section.questions.filter(q => !q.isCompulsory).length;
            
            if (nonCompulsoryCount > 0 && !section.randomSettings.enabled) {
                // If we have any non-compulsory questions but random selection is not enabled
                setErrorMessage(
                    `The "${section.title}" section has ${nonCompulsoryCount} non-compulsory question${nonCompulsoryCount === 1 ? '' : 's'}, 
                    but random selection is not enabled. Either make all questions compulsory or enable random selection.`
                );
                setShowErrorModal(true);
                return false;
            }
            
            if (section.randomSettings.enabled) {
                const nonCompulsoryCount = section.questions.filter(q => !q.isCompulsory).length;
                const selectedCount = section.randomSettings.count;
                const maxAllowed = Math.max(1, nonCompulsoryCount - 1);
                
                if (nonCompulsoryCount < 2) {
                    setErrorMessage(
                        `Random selection requires at least 2 non-compulsory questions. 
                        The "${section.title}" section only has ${nonCompulsoryCount} non-compulsory question${nonCompulsoryCount === 1 ? '' : 's'}.`
                    );
                    setShowErrorModal(true);
                    return false;
                }
                
                if (selectedCount <= 0 || selectedCount > maxAllowed) {
                    setErrorMessage(
                        `In "${section.title}" section, you can select between 1 and ${maxAllowed} random questions.`
                    );
                    setShowErrorModal(true);
                    return false;
                }
            }
        }
        return true;
    };

    useEffect(() => {
        let totalSeconds = 0;
        let totalQuestions = 0;
        let effectiveQuestions = 0;
        
        sections.forEach(section => {
            totalQuestions += section.questions.length;
            
            if (section.randomSettings.enabled) {
                const compulsoryQuestions = section.questions.filter(q => q.isCompulsory);
                effectiveQuestions += compulsoryQuestions.length;
                
                if (section.randomSettings.count > 0) {
                    effectiveQuestions += section.randomSettings.count;
                }
                
                const compulsoryTime = compulsoryQuestions
                    .reduce((sum, q) => sum + (parseInt(q.timeLimit) || 0), 0);
                
                const nonCompulsoryQuestions = section.questions.filter(q => !q.isCompulsory);
                const randomCount = section.randomSettings.count;
                
                if (nonCompulsoryQuestions.length > 0 && randomCount > 0) {
                    const totalNonCompulsoryTime = nonCompulsoryQuestions.reduce((sum, q) => sum + (parseInt(q.timeLimit) || 0), 0);
                    const avgTimePerQuestion = Math.round(totalNonCompulsoryTime / nonCompulsoryQuestions.length);
                    totalSeconds += compulsoryTime + (avgTimePerQuestion * randomCount);
                } else {
                    totalSeconds += compulsoryTime;
                }
            } else {
                section.questions.forEach(question => {
                    totalSeconds += parseInt(question.timeLimit) || 0;
                });
                effectiveQuestions += section.questions.length;
            }
        });
        
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        
        setTotalInterviewTime({ 
            minutes, 
            seconds, 
            totalQuestions,
            effectiveQuestions
        });
    }, [sections]);

    const handleGenerateActualQuestions = async () => {
        if (!selectedApplicant || selectedApplicant === "all") {
            setErrorMessage("Please select a specific applicant to generate questions for.");
            setShowErrorModal(true);
            return;
        }

        setIsLoading(true);
        setLoadingOperation("Generating");

        try {
            const response = await axios.post(
                `http://localhost:8000/api/interview-questions/generate-actual-questions/${selectedApplicant}`
            );

            if (response.status === 200 || response.status === 201) {
                console.log("Actual questions generated successfully:", response.data);
            } else {
                console.error("Unexpected response status:", response.status);
                setErrorMessage("Failed to generate actual questions. Please try again.");
                setShowErrorModal(true);
            }
        } catch (error) {
            console.error("Error generating actual questions:", error);
            let errorMsg = "An error occurred while generating questions. Please try again.";
            
            if (error.response) {
                console.error("Error response data:", error.response.data);
                errorMsg = `Server error: ${error.response.data.detail || error.message}`;
            }
            
            setErrorMessage(errorMsg);
            setShowErrorModal(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        const totalMinutes = totalInterviewTime.minutes + (totalInterviewTime.seconds > 0 ? 1 : 0); // Round up if there are seconds
        if (totalMinutes < 5) {
            setErrorMessage(
                `Your total interview time is less than 5 minutes (currently ${totalInterviewTime.minutes} minute${totalInterviewTime.minutes !== 1 ? 's' : ''} ${totalInterviewTime.seconds > 0 ? `and ${totalInterviewTime.seconds} second${totalInterviewTime.seconds !== 1 ? 's' : ''}` : ''}).

                Please add more questions or increase the time limits to ensure a thorough interview.`
            );
            setShowErrorModal(true);
            return;
        }

        if (!validateSections()) {
            return;
        }

        if (sections.length === 0 || !selectedApplicant) {
            setErrorMessage("Please add at least one section with questions and select an applicant before saving.");
            setShowErrorModal(true);
            return;
        }

        const emptySections = sections.filter(section => section.questions.length === 0);
        if (emptySections.length > 0) {
            setErrorMessage(
                `The "${emptySections[0].title}" section has no questions. Please add at least one question to each section or remove empty sections.`
            );
            setShowErrorModal(true);
            return;
        }

        setIsLoading(true); // Show loading animation
        setLoadingOperation("Saving"); // Set the loading operation

        try {
            const validSections = sections.map(section => ({
                ...section,
                sectionId: section.sectionId || `sect-${Date.now()}`, // Generate sectionId if missing
                questions: section.questions.map(question => {
                    const processedQuestion = { ...question };
                    
                    // For new questions (originalText is null), set the original values to the current values
                    if (processedQuestion.originalText === null) {
                        processedQuestion.originalText = processedQuestion.text;
                        processedQuestion.originalTimeLimit = processedQuestion.timeLimit;
                        processedQuestion.originalCompulsory = processedQuestion.isCompulsory;
                        processedQuestion.isAIModified = false;
                    }
                    
                    // Ensure all questions have all three original properties tracked
                    if (!processedQuestion.hasOwnProperty('originalTimeLimit')) {
                        processedQuestion.originalTimeLimit = processedQuestion.timeLimit;
                    }
                    
                    if (!processedQuestion.hasOwnProperty('originalCompulsory')) {
                        processedQuestion.originalCompulsory = processedQuestion.isCompulsory;
                    }
                    
                    // For AI-generated questions, check modification status but preserve original text
                    if (processedQuestion.isAIGenerated) {
                        // Never change the original AI values, only check if current text matches them
                        const textMatches = processedQuestion.text === processedQuestion.originalText;
                        const timeLimitMatches = !processedQuestion.originalTimeLimit || 
                                               processedQuestion.timeLimit === processedQuestion.originalTimeLimit;
                        const compulsoryMatches = !processedQuestion.hasOwnProperty('originalCompulsory') || 
                                                processedQuestion.isCompulsory === processedQuestion.originalCompulsory;
                        
                        processedQuestion.isAIModified = !(textMatches && timeLimitMatches && compulsoryMatches);
                    }
                    
                    // Add questionId if missing
                    if (!processedQuestion.questionId) {
                        processedQuestion.questionId = `ques-${Date.now()}`;
                    }
                    
                    return processedQuestion;
                })
            })).filter(section => section.questions.length > 0);

            const payload = {
                applicationId: selectedApplicant, // Ensure correct applicationId is used
                candidateId: selectedApplicant === "all" ? "all" : selectedApplicant,
                sections: validSections,
                aiGenerationUsed: selectedApplicant !== "all" && 
                    (aiGenerateUsedMap[selectedApplicant] || aiGeneratedUnsaved)
            };

            let questionSetId = null;
            try {
                const checkResponse = await axios.get(
                    `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
                );
                if (checkResponse.data) {
                    questionSetId = checkResponse.data.questionSetId; // Extract the existing questionSetId
                    console.log("Found existing question set with ID:", questionSetId);
                }
            } catch (error) {
                if (error.response && error.response.status === 404) {
                    console.log("No existing question set found, will create a new one.");
                } else {
                    console.error("Error checking existing question set:", error);
                }
            }

            if (questionSetId) {
                payload.questionSetId = questionSetId;
            }

            console.log("Saving InterviewQuestionSet with payload:", payload);

            const saveResponse = await axios.post(
                "http://localhost:8000/api/interview-questions/save-question-set",
                payload
            );

            console.log("Save response:", saveResponse);

            if (saveResponse.status === 200 || saveResponse.status === 201) {
                console.log("Questions saved successfully:", saveResponse.data);
                setChangesSaved(true); // Mark changes as saved after successful save
                
                // Create a deep copy with all properties preserved, especially isAIModified flags
                const deepCopy = JSON.parse(JSON.stringify(sections));
                
                // Ensure all questions have appropriate originalText values for change detection
                deepCopy.forEach(section => {
                    section.questions.forEach(question => {
                        if (!question.originalText) {
                            question.originalText = question.text;
                        }
                    });
                });
                
                setInitialSections(deepCopy);
                
                if (aiGeneratedUnsaved) {
                    setAiGenerateUsedMap(prev => ({
                        ...prev,
                        [selectedApplicant]: true
                    }));
                    setAiGeneratedUnsaved(false);
                }
                
                setShowSuccessModal(true); // Show success modal
                
                if (selectedApplicant !== "all") {
                    try {
                        console.log("Silently generating actual questions in the background...");
                        
                        const genResponse = await axios.post(
                            `http://localhost:8000/api/interview-questions/generate-actual-questions/${selectedApplicant}`
                        );
                        
                        if (genResponse.status === 200 || genResponse.status === 201) {
                            console.log("Actual questions generated successfully:", genResponse.data);
                        } else {
                            console.warn("Failed to generate actual questions after saving.");
                        }
                    } catch (genError) {
                        console.error("Error generating actual questions after saving:", genError);
                    }
                }
            } else {
                console.error("Unexpected response status:", saveResponse.status);
                setErrorMessage("Failed to save questions. Please try again.");
                setShowErrorModal(true);
            }
        } catch (error) {
            console.error("Error saving questions:", error);
            let errorMsg = "An error occurred while saving questions. Please try again.";
            
            if (error.response) {
                console.error("Error response data:", error.response.data);
                errorMsg = `Server error: ${error.response.data.detail || error.message}`;
            }
            
            setErrorMessage(errorMsg);
            setShowErrorModal(true);
        } finally {
            setIsLoading(false); // Hide loading animation
        }
    };

    const handleInitiateSave = () => {
        if (!selectedApplicant) {
            setErrorMessage("Please select an applicant before saving.");
            setShowErrorModal(true);
            return;
        }
        
        if (sections.length === 0) {
            setErrorMessage("No interview sections or questions added. Please add at least one section with questions before saving.");
            setShowErrorModal(true);
            return;
        }
        
        let hasEmptyQuestions = false;
        let sectionWithEmptyQuestion = "";
        
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            if (section.questions.length === 0) {
                setErrorMessage(
                    `The "${section.title}" section has no questions. Please add at least one question to each section or remove empty sections.`
                );
                setShowErrorModal(true);
                return;
            }
            
            for (let j = 0; j < section.questions.length; j++) {
                if (!section.questions[j].text.trim()) {
                    hasEmptyQuestions = true;
                    sectionWithEmptyQuestion = section.title;
                    break;
                }
            }
            if (hasEmptyQuestions) break;
        }
        
        if (hasEmptyQuestions) {
            setErrorMessage(
                `Please fill in all question fields. There is an empty question in the "${sectionWithEmptyQuestion}" section.`
            );
            setShowErrorModal(true);
            return;
        }
        
        if (selectedApplicant === "all") {
            const totalMinutes = totalInterviewTime.minutes + (totalInterviewTime.seconds > 0 ? 1 : 0);
            if (totalMinutes < 5) {
                setErrorMessage(
                    `Your total interview time is less than 5 minutes (currently ${totalInterviewTime.minutes} minute${totalInterviewTime.minutes !== 1 ? 's' : ''} ${totalInterviewTime.seconds > 0 ? `and ${totalInterviewTime.seconds} second${totalInterviewTime.seconds !== 1 ? 's' : ''}` : ''}).
                    Please add more questions or increase the time limits to ensure a thorough interview.`
                );
                setShowErrorModal(true);
                return;
            }

            if (!validateSections()) {
                return;
            }
            
            setShowApplyToAllModal(true);
        } else {
            setShowSaveConfirmModal(true);
        }
    };

    const navigateToJobDetails = () => {
        setIsNavigatingBack(true);
        
        const jobId = queryParams.get('jobId');
        
        setTimeout(() => {
            if (jobId) {
                navigate(`/dashboard`, { 
                    state: { 
                        directToJobDetails: true,
                        jobId: jobId 
                    }
                });
            } else {
                navigate("/dashboard");
            }
        }, 800);
    };

    const handleConfirmNavigation = () => {
        setShowNavigationModal(false);
        navigateToJobDetails();
    };

    const handleCancelNavigation = () => {
        setShowNavigationModal(false);
    };

    const handleGoBackToJobDetails = () => {
        if (!changesSaved && sections.length > 0) {
            const sectionsJSON = JSON.stringify(sections);
            const initialSectionsJSON = JSON.stringify(initialSections);
            
            if (sectionsJSON !== initialSectionsJSON) {
                setShowNavigationModal(true);
            } else {
                navigateToJobDetails();
            }
        } else {
            navigateToJobDetails();
        }
    };

    useEffect(() => {
    }, [selectedApplicant]);

    const handleApplyToAll = async (overwriteExisting = true) => {
        setShowApplyToAllModal(false);
        
        setIsLoading(true);
        setLoadingOperation("Applying");
        
        try {
            const candidatesResponse = await axios.get(
                `http://localhost:8000/api/candidates/applicants?jobId=${jobId}`
            );
            
            if (!candidatesResponse.data || candidatesResponse.data.length === 0) {
                setErrorMessage("No candidates found for this job.");
                setShowErrorModal(true);
                setIsLoading(false);
                return;
            }
            
            const questionSet = {
                sections: sections.map(section => ({
                    ...section,
                    sectionId: section.sectionId || `sect-${Date.now()}`,
                    questions: section.questions.map(question => ({
                        ...question,
                        questionId: question.questionId || `ques-${Date.now()}`
                    }))
                }))
            };
            
            const payload = {
                jobId: jobId,
                questionSet: questionSet,
                candidates: candidatesResponse.data,
                overwriteExisting: overwriteExisting,
                forceOverwrite: overwriteExisting
            };
            
            const response = await axios.post(
                "http://localhost:8000/api/interview-questions/apply-to-all",
                payload
            );
            
            setApplyToAllStatus({
                successful: response.data.successful.length,
                failed: response.data.failed.length,
                skipped: response.data.skipped.length,
                total: candidatesResponse.data.length
            });
            
            setChangesSaved(true);
            setShowSuccessModal(true);
        } catch (error) {
            console.error("Error applying questions to all candidates:", error);
            setErrorMessage(`Failed to apply questions to all candidates: ${error.message}`);
            setShowErrorModal(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetQuestions = async () => {
        if (!selectedApplicant) {
            setErrorMessage("Please select an applicant first to reset questions.");
            setShowErrorModal(true);
            return;
        }

        if (selectedApplicant === "all") {
            if (sections.length > 0) {
                setShowUnsavedResetModal(true);
            } else {
                setErrorMessage("No interview questions to reset.");
                setShowErrorModal(true);
            }
            return;
        }

        try {
            const response = await axios.get(
                `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
            );
            
            setShowResetConfirmModal(true);
            
        } catch (error) {
            if (error.response && error.response.status === 404) {
                if (sections.length > 0) {
                    setShowUnsavedResetModal(true);
                } else {
                    setErrorMessage("No interview questions found for this applicant.");
                    setShowErrorModal(true);
                }
            } else {
                setErrorMessage(`Error checking question set: ${error.message || "Unknown error"}`);
                setShowErrorModal(true);
            }
        }
    };

    const performReset = async () => {
        setShowResetConfirmModal(false);
        setIsLoading(true);
        setLoadingOperation("Resetting");

        try {
            const response = await axios.delete(
                `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
            );

            if (response.status === 200) {
                setSections([]);
                setChangesSaved(true);
                
                // Reset AI generation flag for this candidate after successful deletion
                setAiGenerateUsedMap(prev => {
                    const newMap = {...prev};
                    delete newMap[selectedApplicant]; // Remove this candidate from the map to enable AI generation again
                    return newMap;
                });
                
                // Reset any unsaved AI generated content flag
                setAiGeneratedUnsaved(false);
                
                setShowResetSuccessModal(true);
            } else {
                throw new Error("Unexpected response status");
            }
        } catch (error) {
            console.error("Error resetting questions:", error);

            if (error.response && error.response.status === 404) {
                setErrorMessage("No interview questions found for this applicant.");
                setShowErrorModal(true);
            } else {
                setErrorMessage(`Error resetting questions: ${error.message || "Unknown error"}`);
                setShowErrorModal(true);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const SuccessModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal success-modal">
                <div className="status-icon success-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 className="status-title">
                    {selectedApplicant === "all" && applyToAllStatus 
                        ? "Questions Applied to All Candidates" 
                        : "Questions Saved!"}
                </h3>
                {selectedApplicant === "all" && applyToAllStatus ? (
                    <div className="status-description">
                        <p>Applied to {applyToAllStatus.successful} out of {applyToAllStatus.total} candidates.</p>
                        {applyToAllStatus.skipped > 0 && (
                            <p>Skipped {applyToAllStatus.skipped} candidates with existing questions.</p>
                        )}
                        {applyToAllStatus.failed > 0 && (
                            <p className="error-text">Failed for {applyToAllStatus.failed} candidates.</p>
                        )}
                    </div>
                ) : (
                    <p className="status-description">Your interview questions have been saved successfully.</p>
                )}
                <div className="status-buttons">
                    <button 
                        className="status-button primary-button" 
                        onClick={async () => {
                            setShowSuccessModal(false);
                            
                            // After saving, we need to fetch the updated data from the database
                            // to ensure we have the correct modification status
                            if (selectedApplicant && selectedApplicant !== "all") {
                                try {
                                    setIsLoading(true);
                                    setLoadingOperation("Refreshing");
                                    
                                    // Fetch the latest data from the server
                                    const response = await axios.get(
                                        `http://localhost:8000/api/interview-questions/question-set/${selectedApplicant}`
                                    );
                                    
                                    if (response.data) {
                                        // Process sections to ensure correct flags
                                        const updatedSections = response.data.sections.map(section => ({
                                            ...section,
                                            questions: section.questions.map(question => {
                                                // Make sure all questions have the proper properties
                                                return {
                                                    ...question,
                                                    // Explicitly handle AI modification status
                                                    isAIModified: question.isAIGenerated 
                                                        ? (question.text !== question.originalText || 
                                                           question.timeLimit !== question.originalTimeLimit ||
                                                           question.isCompulsory !== question.originalCompulsory)
                                                        : false // Regular questions reset to unmodified after save
                                                };
                                            })
                                        }));
                                        
                                        setSections(updatedSections);
                                        
                                        // This is crucial - update initialSections with the latest state
                                        // so change detection works correctly
                                        setInitialSections(JSON.parse(JSON.stringify(updatedSections)));
                                        
                                        // Reset change tracking
                                        setChangesSaved(true);
                                    }
                                } catch (error) {
                                    console.error("Error refreshing question data:", error);
                                } finally {
                                    setIsLoading(false);
                                }
                            }
                            
                            if (selectedApplicant === "all") {
                                setSelectedApplicant("");
                            }
                        }}
                    >
                        {selectedApplicant === "all" ? "Continue" : "Add More Questions"}
                    </button>
                    <button 
                        className="status-button secondary-button" 
                        onClick={() => {
                            navigateToJobDetails();
                        }}
                    >
                        Return to Job Details
                    </button>
                </div>
            </div>
        </div>
    );

    const ErrorModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal error-modal">
                <div className="status-icon error-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"></polygon>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </div>
                <h3 className="status-title">Validation Error</h3>
                <p className="status-description">{errorMessage}</p>
                <div className="status-buttons">
                    <button 
                        className="status-button primary-button" 
                        onClick={() => setShowErrorModal(false)}
                    >
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    );

    const ConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"></polygon>
                        <path d="M12 8v4"></path>
                        <path d="M12 16h.01"></path>
                    </svg>
                </div>
                <h3 className="status-title">Delete Section?</h3>
                <p className="status-description">Are you sure you want to delete this section? All questions in this section will be lost.</p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={handleCancelSectionDelete}>
                        Cancel
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirmSectionDelete}>
                        Delete Section
                    </button>
                </div>
            </div>
        </div>
    );

    const SaveConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon confirm-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                </div>
                <h3 className="status-title">Save Interview Questions?</h3>
                <p className="status-description">
                    Are you sure you want to save the changes to this set of interview questions consisting of {totalInterviewTime.minutes} minute{totalInterviewTime.minutes !== 1 ? 's' : ''} {totalInterviewTime.seconds > 0 ? `and ${totalInterviewTime.seconds} second${totalInterviewTime.seconds !== 1 ? 's' : ''} ` : ''}total interview time?
                </p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={() => setShowSaveConfirmModal(false)}>
                        Continue Editing
                    </button>
                    <button 
                        className="status-button primary-button" 
                        onClick={() => {
                            setShowSaveConfirmModal(false);
                            handleSave();
                        }}
                    >
                        Yes, Save Questions
                    </button>
                </div>
            </div>
        </div>
    );

    const NavigationConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        <path d="M15 6l3 3"></path>
                        <circle cx="18" cy="6" r="1"></circle>
                    </svg>
                </div>
                <h3 className="status-title">Unsaved Changes</h3>
                <p className="status-description">Are you sure you want to leave this page? All interview sections/questions will be lost.</p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={handleCancelNavigation}>
                        Stay on This Page
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirmNavigation}>
                        Leave Page
                    </button>
                </div>
            </div>
        </div>
    );

    const ApplyToAllModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <path d="M12 8v4"></path>
                        <path d="M12 16h.01"></path>
                    </svg>
                </div>
                <h3 className="status-title">Apply to All Candidates</h3>
                <p className="status-description">
                    You are about to apply these interview questions to all candidates for this job. 
                    Some candidates may already have interview questions set up.
                </p>
                <div className="status-buttons">
                    <button 
                        className="status-button secondary-button" 
                        onClick={() => setShowApplyToAllModal(false)}
                    >
                        Cancel
                    </button>
                    <button 
                        className="status-button primary-button" 
                        onClick={() => handleApplyToAll(true)}
                        style={{ pointerEvents: 'auto', opacity: 1 }}
                    >
                        Proceed to Save
                    </button>
                </div>
            </div>
        </div>
    );

    const ResetConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <path d="M12 8v4"></path>
                        <path d="M12 16h.01"></path>
                    </svg>
                </div>
                <h3 className="status-title">Reset All Questions?</h3>
                <p className="status-description">
                    This will permanently delete all interview questions for this applicant. This action cannot be undone.
                </p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={() => setShowResetConfirmModal(false)}>
                        Cancel
                    </button>
                    <button className="status-button danger-button" onClick={performReset}>
                        Yes, Reset All
                    </button>
                </div>
            </div>
        </div>
    );

    const ResetSuccessModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal success-modal">
                <div className="status-icon success-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 className="status-title">Reset Successful</h3>
                <p className="status-description">Interview questions have been reset successfully!</p>
                <div className="status-buttons">
                    <button 
                        className="status-button primary-button" 
                        onClick={() => {
                            setShowResetSuccessModal(false);
                            // Ensure the AI generation map is updated by fetching fresh data
                            if (selectedApplicant) {
                                // Explicitly mark this candidate as not having used AI generation yet
                                setAiGenerateUsedMap(prev => {
                                    const newMap = {...prev};
                                    delete newMap[selectedApplicant];
                                    return newMap;
                                });
                            }
                        }}
                    >
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );

    const UnsavedResetModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </div>
                <h3 className="status-title">Discard Unsaved Changes?</h3>
                <p className="status-description">
                    You haven't saved these questions yet. Are you sure you want to discard all the sections and questions you've just created?
                </p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={() => setShowUnsavedResetModal(false)}>
                        Cancel
                    </button>
                    <button className="status-button danger-button" onClick={() => {
                        setShowUnsavedResetModal(false);
                        if (selectedApplicant === "all") {
                            resetUI(true);
                            setChangesSaved(true);
                            setShowResetSuccessModal(true);
                        } else {
                            resetUI(true);
                            setChangesSaved(true);
                            // Reset AI generation status for this candidate
                            setAiGenerateUsedMap(prev => {
                                const newMap = {...prev};
                                delete newMap[selectedApplicant];
                                return newMap;
                            });
                            setAiGeneratedUnsaved(false);
                            setShowResetSuccessModal(true);
                        }
                    }}>
                        Discard Changes
                    </button>
                </div>
            </div>
        </div>
    );

    const CandidateSwitchModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <path d="M12 8v4"></path>
                        <path d="M12 16h.01"></path>
                    </svg>
                </div>
                <h3 className="status-title">Unsaved Changes</h3>
                <p className="status-description">
                    {selectedApplicant === "all" ? 
                        "You have unsaved interview questions that will apply to all candidates. Switching to another candidate will cause your unsaved changes to be lost." : 
                        "You have unsaved interview questions for the current candidate. Switching to another candidate will cause your unsaved changes to be lost."}
                </p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={handleCancelCandidateSwitch}>
                        Stay and Save Changes
                    </button>
                    <button className="status-button danger-button" onClick={handleConfirmCandidateSwitch}>
                        Switch Candidate
                    </button>
                </div>
            </div>
        </div>
    );

    const handleAIGenerate = () => {
        if (!selectedApplicant) {
            setErrorMessage("Please select an applicant first before generating AI questions.");
            setShowErrorModal(true);
            return;
        }
        
        if (selectedApplicant !== "all" && aiGenerateUsedMap[selectedApplicant]) {
            setErrorMessage("AI generation has been used up for this candidate. You can modify the existing AI-generated questions.");
            setShowErrorModal(true);
            return;
        }
        
        setShowAIConfirmModal(true);
    };

    const handleConfirmAIGenerate = async () => {
        setShowAIConfirmModal(false);
        
        setIsLoading(true);
        setLoadingOperation("Generating");
        
        try {
            const jobId = queryParams.get('jobId');
            
            const response = await axios.get(
                `http://localhost:8000/api/candidates/generate-interview-questions/${selectedApplicant}?job_id=${jobId}`
            );
            
            if (response.status === 200) {
                const generatedData = response.data;
                
                setSections(prevSections => [...prevSections, ...generatedData.sections]);
                
                setAiGeneratedUnsaved(true);
                
                if (selectedApplicant !== "all") {
                    setAiGenerateUsedMap(prev => ({
                        ...prev,
                        [selectedApplicant]: true
                    }));
                }
                
                setShowAISuccess(true);
                
                setTimeout(() => {
                    setShowAISuccess(false);
                }, 3000);
            } else {
                setErrorMessage("Failed to generate questions. Please try again.");
                setShowErrorModal(true);
            }
        } catch (error) {
            console.error("Error generating questions:", error);
            
            const errorMsg = error.response?.data?.detail || 
                             error.message || 
                             "An error occurred while generating questions";
            
            setErrorMessage(errorMsg);
            setShowErrorModal(true);
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartEditingSection = (sectionIndex, currentTitle) => {
        setEditingSectionIndex(sectionIndex);
        setEditedSectionTitle(currentTitle);
    };

    const handleSaveSectionTitle = (sectionIndex) => {
        if (editedSectionTitle.trim()) {
            const updatedSections = [...sections];
            updatedSections[sectionIndex].title = editedSectionTitle.trim();
            setSections(updatedSections);
        }
        setEditingSectionIndex(null);
    };

    const handleKeyPressSectionTitle = (e, sectionIndex) => {
        if (e.key === 'Enter') {
            handleSaveSectionTitle(sectionIndex);
        } else if (e.key === 'Escape') {
            setEditingSectionIndex(null);
        }
    };

    const handleAIGenerateQuestion = async (sectionIndex) => {
        if (!selectedApplicant) {
            setErrorMessage("Please select an applicant or 'Apply to All' to generate questions for.");
            setShowErrorModal(true);
            return;
        }
        
        setGeneratingQuestionForSection(sectionIndex);
        
        try {
            const jobId = queryParams.get('jobId');
            if (!jobId) {
                throw new Error("Job ID is required to generate questions");
            }
            
            const sectionTitle = sections[sectionIndex].title;
            
            // Always use the same endpoint, but modify the payload based on mode
            const endpoint = `http://localhost:8000/api/candidates/generate-interview-question`;
            
            // Different payload based on whether we're in "Apply to All" mode
            const payload = {
                jobId: jobId,
                sectionTitle: sectionTitle,
                // For "Apply to All", use "generic" as the candidateId and add a mode flag
                candidateId: selectedApplicant === "all" ? "generic" : selectedApplicant,
                mode: selectedApplicant === "all" ? "generic" : "specific"
            };
            
            const response = await axios.post(endpoint, payload);
            
            if (response.status === 200) {
                const generatedQuestion = response.data.question;
                const updatedSections = [...sections];
                
                // Add the AI question with proper flags and original values
                updatedSections[sectionIndex].questions.push({
                    ...generatedQuestion,
                    isAIGenerated: true,
                    isAIModified: false,
                    // Store original values so we can detect modifications
                    originalText: generatedQuestion.text,
                    originalTimeLimit: generatedQuestion.timeLimit,
                    originalCompulsory: generatedQuestion.isCompulsory || true
                });
                
                setSections(updatedSections);
            } else {
                throw new Error("Failed to generate question. Please try again.");
            }
        } catch (error) {
            console.error("Error generating question:", error);
            const errorMsg = error.response?.data?.detail || error.message || "An error occurred while generating the question.";
            setErrorMessage(errorMsg);
            setShowErrorModal(true);
        } finally {
            setGeneratingQuestionForSection(null);
        }
    };

    const toggleSectionExpansion = (sectionIndex) => {
        if (editingSectionIndex === sectionIndex) {
            // Don't toggle if currently editing the section title
            return;
        }
        
        setExpandedSections(prev => ({
            ...prev,
            [sectionIndex]: !prev[sectionIndex]
        }));
    };

    const handleMoveSectionUp = (sectionIndex) => {
        if (sectionIndex > 0) {
            const updatedSections = [...sections];
            const temp = updatedSections[sectionIndex];
            updatedSections[sectionIndex] = updatedSections[sectionIndex - 1];
            updatedSections[sectionIndex - 1] = temp;
            
            // Update the expanded state to follow the sections
            const updatedExpandedSections = {};
            Object.keys(expandedSections).forEach(key => {
                const keyNum = parseInt(key);
                if (keyNum === sectionIndex) {
                    updatedExpandedSections[keyNum - 1] = expandedSections[keyNum];
                } else if (keyNum === sectionIndex - 1) {
                    updatedExpandedSections[keyNum + 1] = expandedSections[keyNum];
                } else {
                    updatedExpandedSections[keyNum] = expandedSections[keyNum];
                }
            });
            
            setSections(updatedSections);
            setExpandedSections(updatedExpandedSections);
        }
    };

    const handleMoveSectionDown = (sectionIndex) => {
        if (sectionIndex < sections.length - 1) {
            const updatedSections = [...sections];
            const temp = updatedSections[sectionIndex];
            updatedSections[sectionIndex] = updatedSections[sectionIndex + 1];
            updatedSections[sectionIndex + 1] = temp;
            
            // Update the expanded state to follow the sections
            const updatedExpandedSections = {};
            Object.keys(expandedSections).forEach(key => {
                const keyNum = parseInt(key);
                if (keyNum === sectionIndex) {
                    updatedExpandedSections[keyNum + 1] = expandedSections[keyNum];
                } else if (keyNum === sectionIndex + 1) {
                    updatedExpandedSections[keyNum - 1] = expandedSections[keyNum];
                } else {
                    updatedExpandedSections[keyNum] = expandedSections[keyNum];
                }
            });
            
            setSections(updatedSections);
            setExpandedSections(updatedExpandedSections);
        }
    };

    if (isNavigatingBack || isLoading) {
        return (
            <div style={{ 
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh',
                backgroundColor: '#f8fafc',
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                zIndex: 1000
            }}>
                <div className="loading-indicator" style={{ textAlign: 'center' }}>
                    <LoadingAnimation />
                    <p style={{ marginTop: '20px', color: '#4b5563', fontWeight: '500' }}>
                        {isNavigatingBack ? "Returning to Job Details..." : 
                         `${loadingOperation} Interview Questions...`}
                    </p>
                </div>
            </div>
        );
    }

    const AIConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon ai-warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                </div>
                <h3 className="status-title">One-Time AI Generation</h3>
                <p className="status-description">
                AI question generation can only be used <strong>once per candidate</strong>. 
                Once you click '<strong>Save Changes</strong>',  you cannot use it again. 
                Be careful when modifying or deleting questions, as you won’t be able to regenerate them unless you delete the entire set.
                </p>
                <div className="status-buttons">
                    <button 
                        className="status-button secondary-button" 
                        onClick={() => setShowAIConfirmModal(false)}
                    >
                        Cancel
                    </button>
                    <button 
                        className="status-button primary-button" 
                        onClick={handleConfirmAIGenerate}
                    >
                        Generate Questions
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="add-interview-questions-container">
            {showSuccessModal && <SuccessModal />}
            {showErrorModal && <ErrorModal />}
            {showResetSuccessModal && <ResetSuccessModal />}
            {showConfirmModal && <ConfirmModal />}
            {showSaveConfirmModal && <SaveConfirmModal />}
            {showNavigationModal && <NavigationConfirmModal />}
            {showApplyToAllModal && <ApplyToAllModal />}
            {showResetConfirmModal && <ResetConfirmModal />}
            {showUnsavedResetModal && <UnsavedResetModal />}
            {showCandidateSwitchModal && <CandidateSwitchModal />}
            {showAIConfirmModal && <AIConfirmModal />}
            
            {/* Add CandidateProfileModal */}
            <CandidateProfileModal 
                candidateId={viewingCandidateId} 
                isOpen={showCandidateProfileModal} 
                onClose={() => setShowCandidateProfileModal(false)} 
            />
            
            <div className="page-header">
                <button className="back-button" onClick={handleGoBackToJobDetails}>
                    <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
                    </svg>
                    Back to Job Details
                </button>
                <div className="title-container">
                    <h1>Interview Questions</h1>
                    {jobDetails && <p className="job-title-reference">for {jobDetails.jobTitle}</p>}
                </div>
            </div>
            
            <div className="interview-content">
                <div className="controls-panel">
                    <div className="applicant-selector">
                        <label htmlFor="applicant-select">Select an applicant:</label>
                        <div className="select-actions">
                            <select 
                                id="applicant-select" 
                                value={selectedApplicant}
                                onChange={handleApplicantChange}
                                disabled={isLoadingApplicants}
                                title={selectedApplicant || "Select Applicant"}
                            >
                                <option value="">-- Select applicant --</option>
                                <option value="all">Apply to All</option>
                                {applicants.map(app => (
                                    <option key={app.candidateId} value={app.candidateId} title={app.candidateId}>
                                        {app.candidateId}
                                    </option>
                                ))}
                            </select>
                            
                            {selectedApplicant && selectedApplicant !== "all" && (
                                <button 
                                    className="view-profile-button" 
                                    onClick={handleViewProfile}
                                    aria-label="View applicant profile"
                                >
                                    View Profile
                                </button>
                            )}
                        </div>
                    </div>
                    
                    <div className="ai-generate-button-container">
                        {showAISuccess && (
                            <div className="ai-success-message">
                                <span>✓ AI-generated sections added successfully!</span>
                            </div>
                        )}
                        {selectedApplicant && selectedApplicant !== "all" && (
                            <>
                                {!aiGenerateUsedMap[selectedApplicant] && (
                                    <>
                                        <div className="butterfly"></div>
                                        <div className="butterfly"></div>
                                        <div className="butterfly"></div>
                                        <div className="butterfly"></div>
                                    </>
                                )}
                                <button 
                                    className={`ai-generate-button ${
                                        aiGenerateUsedMap[selectedApplicant] ? 'used' : ''
                                    }`} 
                                    onClick={handleAIGenerate}
                                    title={aiGenerateUsedMap[selectedApplicant] ? 
                                          "AI generation has already been used for this candidate" : 
                                          "Generate interview questions set with AI"}
                                >
                                    <svg className="ai-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                    </svg>
                                    {aiGenerateUsedMap[selectedApplicant] ? 
                                      "AI Sections Added" : 
                                      "AI Generate Sections"}
                                </button>
                            </>
                        )}
                    </div>
                </div>
                
                {selectedApplicant && (
                    <div className="section-creator">
                        <h2>Add New Section</h2>
                        <div className="section-input-group">
                            <input
                                type="text"
                                className="section-title-input"
                                placeholder="Enter section title (e.g., Technical Skills, Work Experience)"
                                value={newSectionTitle}
                                onChange={(e) => setNewSectionTitle(e.target.value)}
                                onKeyPress={(e) => e.key === "Enter" && handleAddSection()}
                            />
                            <button className="add-section-button" onClick={handleAddSection}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="add-icon">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                                Add Section
                            </button>
                        </div>
                    </div>
                )}

                {!selectedApplicant ? (
                    <div className="no-sections applicant-select-prompt">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="empty-icon">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                        </svg>
                        <p>Please select an applicant to get started.</p>
                        <p>You'll be able to create interview questions after selecting an applicant.</p>
                    </div>
                ) : sections.length === 0 ? (
                    <div className="no-sections">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="empty-icon">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h6M8 17h4M19 3H5a2 2 0 00-2 2v14a2 2 0 00-2 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"></path>
                        </svg>
                        <p>No interview question sections added yet.</p>
                        <p>Add a section to get started or use AI Generate.</p>
                    </div>
                ) : (
                    <div className="sections-container">
                        {sections.map((section, sectionIndex) => (
                            <div 
                                key={sectionIndex} 
                                className={`section-card ${section.isAIGenerated ? 'ai-generated-section' : ''} ${generatingQuestionForSection === sectionIndex ? 'generating-question' : ''} ${expandedSections[sectionIndex] ? 'expanded' : 'collapsed'}`}
                            >
                                <div 
                                    className={`section-header ${editingSectionIndex === sectionIndex ? 'editing' : ''}`}
                                    data-section={`Section ${sectionIndex + 1}`}
                                    onClick={() => toggleSectionExpansion(sectionIndex)}
                                >
                                    {editingSectionIndex === sectionIndex ? (
                                        <div className="section-title-edit-container" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="text"
                                                className="section-title-input-edit"
                                                value={editedSectionTitle}
                                                onChange={(e) => setEditedSectionTitle(e.target.value)}
                                                onBlur={() => handleSaveSectionTitle(sectionIndex)}
                                                onKeyDown={(e) => handleKeyPressSectionTitle(e, sectionIndex)}
                                                autoFocus
                                            />
                                            <div className="edit-actions">
                                                <button 
                                                    className="save-edit-button"
                                                    onClick={() => handleSaveSectionTitle(sectionIndex)}
                                                    title="Save title"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                </button>
                                                <button 
                                                    className="cancel-edit-button"
                                                    onClick={() => setEditingSectionIndex(null)}
                                                    title="Cancel edit"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="section-title-editable">
                                            <h2 className="section-title">{section.title}</h2>
                                            <button 
                                                className="edit-title-button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleStartEditingSection(sectionIndex, section.title);
                                                }}
                                                aria-label={`Edit section ${section.title}`}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                </svg>
                                            </button>
                                        </div>
                                    )}
                                    <div className="section-actions">
                                        <div className="section-move-controls" onClick={(e) => e.stopPropagation()}>
                                            <button 
                                                className="move-section-button move-up"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMoveSectionUp(sectionIndex);
                                                }}
                                                disabled={sectionIndex === 0}
                                                aria-label="Move section up"
                                                title="Move section up"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="18 15 12 9 6 15"></polyline>
                                                </svg>
                                            </button>
                                            <button 
                                                className="move-section-button move-down"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMoveSectionDown(sectionIndex);
                                                }}
                                                disabled={sectionIndex === sections.length - 1}
                                                aria-label="Move section down"
                                                title="Move section down"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="6 9 12 15 18 9"></polyline>
                                                </svg>
                                            </button>
                                        </div>
                                        <button 
                                            className="remove-section-button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveSection(sectionIndex);
                                            }}
                                            aria-label={`Remove section ${section.title}`}
                                        >
                                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="section-content">
                                    <div className="section-random-settings">
                                        <div className="random-toggle">
                                            <label className={`random-label ${section.questions.filter(q => !q.isCompulsory).length >= 2 ? 'auto-enabled' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={section.randomSettings.enabled || section.questions.filter(q => !q.isCompulsory).length >= 2}
                                                    onChange={(e) => handleSectionRandomSettingsChange(sectionIndex, e.target.checked)}
                                                    className="random-checkbox"
                                                    disabled={section.questions.filter(q => !q.isCompulsory).length >= 2}
                                                />
                                                <span>
                                                    {section.questions.filter(q => !q.isCompulsory).length >= 2 
                                                        ? "Random question selection enabled automatically" 
                                                        : "Enable random question selection"
                                                    }
                                                </span>
                                            </label>
                                            
                                            {section.questions.filter(q => !q.isCompulsory).length < 2 && (
                                                <span className="random-disabled-note">
                                                    (Requires at least 2 non-compulsory questions)
                                                </span>
                                            )}
                                        </div>
                                        
                                        {section.randomSettings.enabled && (
                                            <div className="random-count-selector">
                                                <label htmlFor={`random-count-${sectionIndex}`}>
                                                    <span>Select</span>
                                                    <input
                                                        id={`random-count-${sectionIndex}`}
                                                        type="number"
                                                        min="1"
                                                        max={Math.max(1, section.questions.filter(q => !q.isCompulsory).length - 1)}
                                                        value={section.randomSettings.count}
                                                        onChange={(e) => handleRandomCountChange(sectionIndex, e.target.value)}
                                                        className={`random-count-input ${
                                                            section.randomSettings.count > Math.max(1, section.questions.filter(q => !q.isCompulsory).length - 1) ? 'invalid' : ''
                                                        }`}
                                                    />
                                                    <span>out of {section.questions.filter(q => !q.isCompulsory).length} non-compulsory questions</span>
                                                </label>
                                                
                                                {section.randomSettings.count > Math.max(1, section.questions.filter(q => !q.isCompulsory).length - 1) && (
                                                    <div className="random-count-warning">
                                                        <svg className="warning-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                                            <line x1="12" y1="9" x2="12" y2="13"></line>
                                                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                                        </svg>
                                                        <span>You can select at most {Math.max(1, section.questions.filter(q => !q.isCompulsory).length - 1)} questions to maintain randomness</span>
                                                    </div>
                                                )}
                                                
                                                <div className="random-help-text">
                                                    <span>Compulsory questions always appear. Random questions will be selected from the remaining pool.</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div className="questions-container">
                                        {section.questions.map((question, questionIndex) => (
                                            <div 
                                                key={questionIndex} 
                                                className={`question-item ${question.isCompulsory ? 'compulsory-item' : 'optional-item'} ${question.isAIGenerated ? 'ai-generated-question' : ''}`}
                                            >
                                                <div className="q-content">
                                                    <div className={`question-header ${question.isAIGenerated ? 'ai-generated-header' : ''}`}>
                                                        <div className="question-number">{questionIndex + 1}</div>
                                                        <div className="question-type-indicator">
                                                            {question.isCompulsory ? 
                                                                <span className="compulsory-badge">Compulsory</span> : 
                                                                <span className="optional-badge">Optional</span>
                                                            }
                                                            
                                                            {question.isAIGenerated && (
                                                                <span className={`ai-badge ${question.isAIModified ? 'ai-modified' : ''}`}>
                                                                    {question.isAIModified ? 'AI Generated (Edited)' : 'AI Generated'}
                                                                </span>
                                                            )}
                                                            {!question.isAIGenerated && question.isAIModified && (
                                                                <span className={`ai-badge ai-modified`}>
                                                                    Modified
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button 
                                                            className="remove-question-button"
                                                            onClick={() => handleRemoveQuestion(sectionIndex, questionIndex)}
                                                            aria-label="Remove question"
                                                        >
                                                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    
                                                    <textarea
                                                        className={`question-textarea ${question.isCompulsory ? 'compulsory' : 'optional'} ${question.isAIGenerated ? 'ai-generated-textarea' : ''}`}
                                                        placeholder="Enter interview question"
                                                        value={question.text}
                                                        onChange={(e) => handleQuestionChange(sectionIndex, questionIndex, e.target.value)}
                                                    />
                                                    
                                                    <div className={`question-controls ${question.isAIGenerated ? 'ai-generated-controls' : ''}`}>
                                                        <div className="question-time-control">
                                                            <svg className="time-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <circle cx="12" cy="12" r="10"></circle>
                                                                <polyline points="12 6 12 12 16 14"></polyline>
                                                            </svg>
                                                            <label htmlFor={`time-limit-${sectionIndex}-${questionIndex}`}>
                                                                Time Limit:
                                                            </label>
                                                            <input
                                                                id={`time-limit-${sectionIndex}-${questionIndex}`}
                                                                type="number"
                                                                min="1"
                                                                max="300"
                                                                value={question.timeLimit}
                                                                onChange={(e) => 
                                                                    handleQuestionTimeChange(sectionIndex, questionIndex, e.target.value)
                                                                }
                                                                className="time-input"
                                                            />
                                                            <span className="time-unit">seconds</span>
                                                        </div>
                                                        
                                                        <div className="question-compulsory-control">
                                                            <label className="compulsory-label">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={question.isCompulsory}
                                                                    onChange={(e) => 
                                                                        handleQuestionCompulsoryChange(sectionIndex, questionIndex, e.target.checked)
                                                                    }
                                                                    className="compulsory-checkbox"
                                                                />
                                                                Make compulsory
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                        {generatingQuestionForSection === sectionIndex && (
                                            <TypingAnimation sectionTitle={section.title} />
                                        )}
                                    </div>
                                    
                                    <div className="question-actions-container">
                                        <button
                                            className="add-question-button"
                                            onClick={() => handleAddQuestion(sectionIndex)}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="add-q-icon">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                            </svg>
                                            Add Question
                                        </button>
                                        <button
                                            className="ai-generate-question-button"
                                            onClick={() => handleAIGenerateQuestion(sectionIndex)}
                                            disabled={!selectedApplicant}
                                            title={!selectedApplicant ? "Select an applicant first" : 
                                                "Generate a question with AI for this section"}
                                        >
                                            <svg className="ai-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                            </svg>
                                            AI Generate Question
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                
                {selectedApplicant && (
                    <div className="interview-stats-summary">
                        <div className="stats-item time-stats">
                            <div className="stats-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                            </div>
                            <div className="stats-content">
                                <span className="stats-label">Total Interview Time:</span>
                                <span className="stats-value">
                                    {totalInterviewTime.minutes} minute{totalInterviewTime.minutes !== 1 ? 's' : ''} 
                                    {totalInterviewTime.seconds > 0 ? ` and ${totalInterviewTime.seconds} second${totalInterviewTime.seconds !== 1 ? 's' : ''}` : ''}
                                </span>
                            </div>
                        </div>
                        
                        <div className="stats-item question-stats">
                            <div className="stats-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M8 9h8M8 13h6M8 17h4M19 3H5a2 2 0 00-2 2v14a2 2 0 00-2 2h14a2 2 0 002-2V5a2 2 0 00-2-2z"></path>
                                </svg>
                            </div>
                            <div className="stats-content">
                                <span className="stats-label">Total Effective Questions Set For Interview:</span>
                                <span className="stats-value">
                                    {totalInterviewTime.effectiveQuestions || 0}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {selectedApplicant && (
                    <div className="save-container">
                        <div className="action-buttons">
                            <button 
                                className="reset-button" 
                                onClick={handleResetQuestions}
                                disabled={!selectedApplicant}
                                title={!selectedApplicant ? "Select an applicant first" : 
                                      "Delete all questions for this applicant"}
                            >
                                Reset All Questions
                            </button>
                            <button 
                                className="save-button" 
                                onClick={handleInitiateSave}
                                disabled={sections.length === 0}
                                title={sections.length === 0 ? 
                                    "Please add at least one section with questions before saving" : 
                                    "Save interview questions"}
                            >
                                Save Questions
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AddInterviewQuestions;
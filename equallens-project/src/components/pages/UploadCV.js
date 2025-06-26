import React, { useState, useRef, useEffect, useCallback, useMemo, useReducer } from "react";
import "./UploadCV.css";
import AIConfirmationModal from '../AIConfirmationModal.js';
import DuplicateFilesModal from '../DuplicateFilesModal'; // Import the duplicates modal
import "../pageloading.css"; // Import the loading animation CSS

// Add these imports at the top
import BiasDetectionModal from '../BiasDetectionModal';
import BiasHighlightingInput from '../BiasHighlightingInput';
import JobSuggestionModal from '../JobSuggestionModal';
import SkillTagWithLogo from '../SkillTagWithLogo';

// MODIFIED: Expanded reducer to handle duplicates and AI flags
const fileUploadReducer = (state, action) => {
    switch (action.type) {
        case 'ADD_FILES':
            return {
                ...state,
                selectedFiles: action.payload.updatedFiles,
                uploadQueue: action.payload.newQueue,
                processingFiles: true
            };
        case 'FILE_PROGRESS':
            return {
                ...state,
                uploadProgress: {
                    ...state.uploadProgress,
                    [action.payload.fileName]: action.payload.progress
                }
            };
        case 'PROCESS_NEXT':
            return { ...state, isLoading: true };
        case 'FILE_COMPLETE':
            return { ...state, uploadQueue: state.uploadQueue.slice(1) };
        case 'QUEUE_COMPLETE':
            return { ...state, isLoading: false, processingFiles: false };
        case 'REMOVE_FILE':
            const fileToRemove = state.selectedFiles[action.payload.index];
            return {
                ...state,
                selectedFiles: state.selectedFiles.filter((_, i) => i !== action.payload.index),
                uploadQueue: fileToRemove ? state.uploadQueue.filter(queueFile => queueFile.name !== fileToRemove.name) : state.uploadQueue,
                uploadProgress: fileToRemove ? Object.fromEntries(Object.entries(state.uploadProgress).filter(([key]) => key !== fileToRemove.name)) : state.uploadProgress
            };
        case 'FOUND_DUPLICATES': // NEW
            return {
                ...state,
                duplicateFiles: action.payload.duplicates,
                nonDuplicateFiles: action.payload.nonDuplicateFiles,
                showDuplicatesModal: true,
                processingFiles: false,
                isLoading: false,
                isModalHidden: true // Hide main modal content
            };
        case 'CLOSE_DUPLICATES_MODAL': // NEW
            return { ...state, showDuplicatesModal: false, isModalHidden: false };
        case 'RESET':
            return {
                selectedFiles: [],
                isLoading: false,
                uploadProgress: {},
                uploadQueue: [],
                processingFiles: false,
                duplicateFiles: [],
                nonDuplicateFiles: [],
                showDuplicatesModal: false,
                isModalHidden: false
            };
        default:
            return state;
    }
};

const UploadCV = () => {
    // MODIFIED: Expanded reducer state
    const [fileState, fileDispatch] = useReducer(fileUploadReducer, {
        selectedFiles: [],
        isLoading: false,
        uploadProgress: {},
        uploadQueue: [],
        processingFiles: false,
        duplicateFiles: [],
        nonDuplicateFiles: [],
        showDuplicatesModal: false,
        isModalHidden: false
    });

    const [currentStep, setCurrentStep] = useState("jobDetails");
    const [jobData, setJobData] = useState(null);
    const [apiStatus, setApiStatus] = useState("idle");
    const [submitProgress, setSubmitProgress] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    const uploadContainerRef = useRef(null);
    const progressAnimationRef = useRef(null);
    const [jobTitle, setJobTitle] = useState("");
    const [jobTitleSuggestions, setJobTitleSuggestions] = useState([]);
    const [showJobTitleSuggestions, setShowJobTitleSuggestions] = useState(false);
    const [jobDescription, setJobDescription] = useState("");
    const [requirements, setRequirements] = useState("");
    const [departments, setDepartments] = useState([]);
    const [departmentInput, setDepartmentInput] = useState("");
    const [departmentSuggestions, setDepartmentSuggestions] = useState([]);
    const [showDepartmentSuggestions, setShowDepartmentSuggestions] = useState(false);
    const [minimumCGPA, setMinimumCGPA] = useState(2.50);
    const [cgpaInputValue, setCgpaInputValue] = useState("2.50");
    const [cgpaError, setCgpaError] = useState(false);
    const [isCgpaApplicable, setIsCgpaApplicable] = useState(true);
    const [skillInput, setSkillInput] = useState("");
    const [skillSuggestions, setSkillSuggestions] = useState([]);
    const [showSkillSuggestions, setShowSkillSuggestions] = useState(false);
    const [skills, setSkills] = useState([]);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [showBiasModal, setShowBiasModal] = useState(false);
    const [biasResults, setBiasResults] = useState({});
    const [biasedTerms, setBiasedTerms] = useState({ jobTitle: [], jobDescription: [], requirements: [], requiredSkills: [], departments: [] });
    const [isCheckingBias, setIsCheckingBias] = useState(false);
    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [suggestionContext, setSuggestionContext] = useState({ core_responsibilities: "", key_skills: "", company_culture: "", experience_level: "" });
    const [generatedSuggestions, setGeneratedSuggestions] = useState(null);
    const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
    const [showGeneratedSuggestions, setShowGeneratedSuggestions] = useState(false);

    // NEW: State for AI/Irrelevance/Spam flags and modals
    const [showAIConfirmModal, setShowAIConfirmModal] = useState(false);
    const [flaggedAIData, setFlaggedAIData] = useState([]);
    const [fileFlags, setFileFlags] = useState({}); // { filename: {is_ai_generated, is_irrelevant, ...} }
    const [userConsentedToAIUpload, setUserConsentedToAIUpload] = useState(false);
    const [userConsentedToIrrelevantUpload, setUserConsentedToIrrelevantUpload] = useState(false);
    const [pendingJobCreationPayloadJson, setPendingJobCreationPayloadJson] = useState(null);
    const [pendingUserTimeZone, setPendingUserTimeZone] = useState("UTC"); // Default or from API

    const [pendingAnalysisPayloads, setPendingAnalysisPayloads] = useState({
        successful: [],
        flagged: []
    });
    const [pendingJobPayload, setPendingJobPayload] = useState(null);


    const jobTitleOptions = useMemo(() => ["Software Engineer", "Data Scientist", "Project Manager", "Web Developer", "UI/UX Designer", "Product Manager", "DevOps Engineer", "Systems Analyst", "Frontend Developer", "Backend Developer", "Full Stack Developer", "Machine Learning Engineer", "Business Analyst", "Quality Assurance Engineer"], []);
    const departmentOptions = useMemo(() => ["Engineering", "Information Technology", "Marketing", "Finance", "Human Resources", "Sales", "Operations", "Customer Support", "Research & Development", "Legal", "Administration", "Design", "Product Management", "Business Development", "Data Science"], []);
    const skillsOptions = useMemo(() => ["JavaScript", "Python", "Java", "React", "Node.js", "SQL", "AWS", "Docker", "DevOps", "Machine Learning", "Data Analysis", "Agile", "Scrum", "Project Management", "UI/UX Design", "TypeScript", "Go", "Ruby", "Communication", "Leadership", "Problem Solving", "C#", "PHP", "Angular", "Vue.js", "MongoDB", "GraphQL", "REST API", "Git"], []);

    const handleOpenSuggestionModal = () => setShowSuggestionModal(true);
    const handleCloseSuggestionModal = () => { setShowSuggestionModal(false); setIsGeneratingSuggestions(false); };

    const handleGenerateSuggestions = async (contextData) => {
        if (!jobTitle.trim()) { alert("Please enter a Job Title before generating suggestions."); return; }
        setIsGeneratingSuggestions(true);
        setGeneratedSuggestions(null);
        setShowGeneratedSuggestions(false);
        try {
            const response = await fetch('http://localhost:8000/api/jobs/suggest-details', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_title: jobTitle, ...contextData }) });
            if (!response.ok) { const errorData = await response.json().catch(() => ({ detail: "Unknown error generating suggestions" })); throw new Error(errorData.detail || `HTTP error ${response.status}`); }
            const suggestions = await response.json();
            setGeneratedSuggestions(suggestions);
            setShowGeneratedSuggestions(true);
            handleCloseSuggestionModal();
        } catch (error) { console.error("Error generating suggestions:", error); alert(`Failed to generate suggestions: ${error.message}`); handleCloseSuggestionModal(); } finally { setIsGeneratingSuggestions(false); }
    };

    const handleApplySuggestion = (type) => {
        if (!generatedSuggestions) return;
        if (type === 'description' || type === 'both') {
            setJobDescription(generatedSuggestions.description);
            const descElement = document.getElementById("jobDescription");
            if (descElement) { setTimeout(() => { descElement.style.height = "auto"; descElement.style.height = `${descElement.scrollHeight}px`; }, 0); }
        }
        if (type === 'requirements' || type === 'both') {
            setRequirements(generatedSuggestions.requirements);
            const reqElement = document.getElementById("requirements");
            if (reqElement) { setTimeout(() => { reqElement.style.height = "auto"; reqElement.style.height = `${reqElement.scrollHeight}px`; }, 0); }
        }
        setShowSuggestionModal(false);
        setShowGeneratedSuggestions(false);
    };

    const toggleSuggestionDisplay = () => setShowGeneratedSuggestions(prev => !prev);
    const handleRequirementsInput = (e) => { const target = e.target.closest('.bias-highlighting-input'); if (target) { target.style.height = "auto"; target.style.height = `${target.scrollHeight}px`; } };

    const analyzeBias = async () => {
        setIsCheckingBias(true);
        setBiasResults({});
        setBiasedTerms({ jobTitle: [], jobDescription: [], requirements: [], requiredSkills: [], departments: [] });
        try {
            const requestBody = { jobTitle, jobDescription, requirements, departments, requiredSkills: skills, minimumCGPA: isCgpaApplicable ? minimumCGPA : null };
            const response = await fetch('http://localhost:8000/api/bias-detection/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
            if (!response.ok) { const errorData = await response.json().catch(() => ({ detail: "Unknown bias analysis error" })); console.error("Bias analysis API error response:", errorData); throw new Error(errorData.detail || `Bias analysis failed with status ${response.status}`); }
            const data = await response.json();
            const receivedBiasedFields = data.biasedFields || {};
            const receivedBiasedTerms = data.biasedTerms || {};
            setBiasResults(receivedBiasedFields);
            setBiasedTerms({ jobTitle: receivedBiasedTerms.jobTitle || [], jobDescription: receivedBiasedTerms.jobDescription || [], requirements: receivedBiasedTerms.requirements || [], requiredSkills: receivedBiasedTerms.requiredSkills || [], departments: receivedBiasedTerms.departments || [] });
            setIsCheckingBias(false);
            if (data.hasBias || Object.keys(receivedBiasedFields).length > 0 || Object.values(receivedBiasedTerms).some(terms => terms.length > 0)) { setShowBiasModal(true); return true; }
            return false;
        } catch (error) { console.error("Error analyzing bias:", error); alert(`Could not analyze bias: ${error.message}`); setIsCheckingBias(false); return true; }
    };

    useEffect(() => { if (jobTitle) { const filtered = jobTitleOptions.filter(option => option.toLowerCase().includes(jobTitle.toLowerCase())); setJobTitleSuggestions(filtered); setShowJobTitleSuggestions(filtered.length > 0); } else { setShowJobTitleSuggestions(false); } }, [jobTitle, jobTitleOptions]);
    useEffect(() => { if (departmentInput) { const filtered = departmentOptions.filter(option => option.toLowerCase().includes(departmentInput.toLowerCase())); setDepartmentSuggestions(filtered); setShowDepartmentSuggestions(filtered.length > 0); } else { setShowDepartmentSuggestions(false); } }, [departmentInput, departmentOptions]);
    useEffect(() => { if (skillInput) { const filtered = skillsOptions.filter(option => option.toLowerCase().includes(skillInput.toLowerCase())); setSkillSuggestions(filtered); setShowSkillSuggestions(filtered.length > 0); } else { setShowSkillSuggestions(false); } }, [skillInput, skillsOptions]);
    const handleJobTitleSelect = (selected) => { setJobTitle(selected); setShowJobTitleSuggestions(false); const inputElement = document.getElementById("jobTitle"); if (inputElement) { inputElement.innerText = selected; } };
    const handleSkillSelect = (selected) => { if (!skills.includes(selected)) { setSkills([...skills, selected]); } setSkillInput(""); setShowSkillSuggestions(false); };
    useEffect(() => { const handleClickOutside = (event) => { if (!event.target.closest('.suggestion-container')) { setShowJobTitleSuggestions(false); setShowSkillSuggestions(false); setShowDepartmentSuggestions(false); } }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, []);

    const processFiles = useCallback((files) => {
        if (fileState.isLoading || fileState.processingFiles) { alert("Please wait for the current file to complete uploading before adding new files."); return; }
        let updatedFiles = [...fileState.selectedFiles];
        let newFiles = [];
        const newFileFlags = { ...fileFlags };
        for (const fileToProcess of files) {
            const extension = fileToProcess.name.split('.').pop().toLowerCase();
            const validExtensions = ['pdf', 'doc', 'docx'];
            if (!validExtensions.includes(extension)) { alert(`${fileToProcess.name} is not a supported file type. Please upload PDF, DOC, or DOCX files only.`); continue; }
            const existingIndex = updatedFiles.findIndex(file => file.name === fileToProcess.name);
            if (existingIndex !== -1) {
                if (window.confirm(`A file named "${fileToProcess.name}" already exists. Do you want to replace it?`)) {
                    delete newFileFlags[fileToProcess.name];
                    updatedFiles[existingIndex] = fileToProcess;
                    newFiles.push(fileToProcess);
                }
            } else {
                delete newFileFlags[fileToProcess.name];
                updatedFiles.push(fileToProcess);
                newFiles.push(fileToProcess);
            }
        }
        if (newFiles.length > 0) {
            setFileFlags(newFileFlags);
            const newQueue = [...fileState.uploadQueue.filter(queueFile => !newFiles.some(newFile => newFile.name === queueFile.name)), ...newFiles];
            fileDispatch({ type: 'ADD_FILES', payload: { updatedFiles, newQueue } });
        }
    }, [fileState.selectedFiles, fileState.isLoading, fileState.processingFiles, fileState.uploadQueue, fileFlags]);

    useEffect(() => { if (fileState.uploadQueue.length === 0) { if (fileState.processingFiles) { fileDispatch({ type: 'QUEUE_COMPLETE' }); } return; } const processAllFiles = async () => { for (const fileToProcess of fileState.uploadQueue) { fileDispatch({ type: 'FILE_PROGRESS', payload: { fileName: fileToProcess.name, progress: 100 } }); } fileState.uploadQueue.forEach(() => fileDispatch({ type: 'FILE_COMPLETE' })); }; processAllFiles(); }, [fileState.uploadQueue, fileState.processingFiles]);
    useEffect(() => { const uploadContainer = uploadContainerRef.current; if (uploadContainer) { const handleLocalDragOver = (event) => { event.preventDefault(); uploadContainer.classList.add('dragover'); }; const handleLocalDragLeave = () => uploadContainer.classList.remove('dragover'); const handleLocalDrop = () => uploadContainer.classList.remove('dragover'); uploadContainer.addEventListener('dragover', handleLocalDragOver); uploadContainer.addEventListener('dragleave', handleLocalDragLeave); uploadContainer.addEventListener('drop', handleLocalDrop); return () => { uploadContainer.removeEventListener('dragover', handleLocalDragOver); uploadContainer.removeEventListener('dragleave', handleLocalDragLeave); uploadContainer.removeEventListener('drop', handleLocalDrop); }; } }, []);
    useEffect(() => { if (currentStep !== "uploadCV") return; const handleDocumentDragOver = (event) => { event.preventDefault(); if (!isDragging && !fileState.isLoading && !fileState.processingFiles) { setIsDragging(true); } }; const handleDocumentDragLeave = (event) => { event.preventDefault(); if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) { setIsDragging(false); } }; const handleDocumentDrop = (event) => { event.preventDefault(); setIsDragging(false); if (fileState.isLoading || fileState.processingFiles) { alert("Please wait for the current file to complete uploading before adding new files."); return; } const files = Array.from(event.dataTransfer.files); if (files.length > 0) { processFiles(files); } }; document.addEventListener('dragover', handleDocumentDragOver); document.addEventListener('dragleave', handleDocumentDragLeave); document.addEventListener('drop', handleDocumentDrop); return () => { document.removeEventListener('dragover', handleDocumentDragOver); document.removeEventListener('dragleave', handleDocumentDragLeave); document.removeEventListener('drop', handleDocumentDrop); }; }, [isDragging, processFiles, fileState.isLoading, fileState.processingFiles, currentStep]);
    const handleFileChange = (event) => { const files = Array.from(event.target.files); if (files.length > 0) { processFiles(files); event.target.value = ''; } };
    const handleDragOver = (event) => { event.preventDefault(); if (!fileState.isLoading && !fileState.processingFiles) { event.dataTransfer.dropEffect = 'copy'; } else { event.dataTransfer.dropEffect = 'none'; } };
    const handleDrop = (event) => { event.preventDefault(); setIsDragging(false); if (fileState.isLoading || fileState.processingFiles) { alert("Please wait for the current file to complete uploading before adding new files."); return; } const files = Array.from(event.dataTransfer.files); if (files.length > 0) { processFiles(files); } };
    const handleFileInputKeyDown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current.click(); } };
    const removeFile = (index) => { const fileToRemove = fileState.selectedFiles[index]; if (fileToRemove) { setFileFlags(prevFlags => { const newFlags = { ...prevFlags }; delete newFlags[fileToRemove.name]; return newFlags; }); } fileDispatch({ type: 'REMOVE_FILE', payload: { index } }); };
    const handleChooseFile = () => fileInputRef.current.click();
    const getFileIcon = (fileName) => { const ext = fileName.split('.').pop().toLowerCase(); if (ext === 'pdf') return <div className="file-icon pdf-icon">PDF</div>; if (['doc', 'docx'].includes(ext)) return <div className="file-icon doc-icon">DOC</div>; return <div className="file-icon default-icon">FILE</div>; };
    const getFullPageOverlay = () => { if (!isDragging) return null; return (<div className="fullpage-drop-overlay"><div className="drop-content"><div className="file-preview"><div className="file-icon-large pdf-icon-large">FILE</div>{fileState.selectedFiles.length > 0 && <div className="copy-badge">Copy</div>}</div><h2 className="drop-title">Drop files anywhere</h2><p className="drop-subtitle">Drop file(s) to upload it</p></div></div>); };
    const handleAddSkill = () => { if (skillInput.trim() && !skills.includes(skillInput.trim())) { setSkills([...skills, skillInput.trim()]); setSkillInput(""); } };
    const removeSkill = (skill) => setSkills(skills.filter(s => s !== skill));
    const handleSkillKeyPress = (e) => { if (e.key === 'Enter' && skillInput.trim()) { e.preventDefault(); handleAddSkill(); } };
    const handleDepartmentSelect = (department) => { if (!departments.includes(department)) { setDepartments([...departments, department]); } setDepartmentInput(""); setShowDepartmentSuggestions(false); };
    const handleAddDepartment = () => { if (departmentInput.trim() && !departments.includes(departmentInput.trim())) { setDepartments([...departments, departmentInput.trim()]); setDepartmentInput(""); } };
    const handleDepartmentKeyPress = (e) => { if (e.key === 'Enter' && departmentInput.trim()) { e.preventDefault(); handleAddDepartment(); } };
    const removeDepartment = (department) => setDepartments(departments.filter(dept => dept !== department));
    const validateForm = () => { if (!jobTitle.trim()) { alert("Job Title is required"); return false; } if (skills.length === 0) { alert("At least one Required Skill is required"); return false; } return true; };
    const handleSubmit = async (e) => { e.preventDefault(); if (validateForm()) { const hasBiasOrError = await analyzeBias(); if (hasBiasOrError) { return; } let combinedDescription = jobDescription; if (requirements && requirements.trim()) { combinedDescription += "\n\nRequirements/ Qualifications:\n" + requirements; } const jobDetails = { jobTitle, jobDescription: combinedDescription, departments, minimumCGPA: isCgpaApplicable ? minimumCGPA : null, skills, requiredSkills: skills }; setJobData(jobDetails); setCurrentStep("uploadCV"); window.scrollTo({ top: 0, behavior: 'smooth' }); } };
    const handleBackToJobDetails = () => { setCurrentStep("jobDetails"); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => { updateSliderPercentage(minimumCGPA); }, 100); };
    const API_URL = "http://localhost:8000";
    const API_ENDPOINT = `${API_URL}/api/jobs/upload-job`;
    useEffect(() => { return () => { if (progressAnimationRef.current) { cancelAnimationFrame(progressAnimationRef.current); progressAnimationRef.current = null; } }; }, []);
    const LoadingAnimation = () => (<div className="loading-animation"><div className="seesaw-container"><div className="bar"></div><div className="ball"></div></div></div>);
    const SuccessModal = () => (<div className="status-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="success-modal-title"><div className="status-modal success-modal"><div className="status-icon success-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div><h3 id="success-modal-title" className="status-title">Submission Complete!</h3><p className="status-description"><strong>Your files have been uploaded successfully</strong></p><div className="status-buttons"><button className="status-button secondary-button" onClick={handleCreateMoreJob}>Create More Job</button><button className="status-button primary-button" onClick={handleGoToDashboard} autoFocus>Go to Dashboard</button></div></div></div>);
    const ErrorModal = () => (<div className="status-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="error-modal-title"><div className="status-modal error-modal"><div className="status-icon error-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div><h3 id="error-modal-title" className="status-title">Submission Failed!</h3><p className="status-message">{errorMessage || "Please try again"}</p><div className="status-buttons"><button className="status-button primary-button" onClick={handleTryAgain} autoFocus>Try Again</button></div></div></div>);
    const handleGoToDashboard = () => { setShowSuccessModal(false); window.location.href = "/dashboard"; };
    const handleTryAgain = () => { setShowErrorModal(false); setApiStatus("idle"); setSubmitProgress(0); };

    // NEW: Handlers for AI/Irrelevance Modal
    const handleAIReviewCVs = () => {
        const newFlags = { ...fileFlags };
        flaggedAIData.forEach(flaggedFile => {
            newFlags[flaggedFile.filename] = {
                is_ai_generated: flaggedFile.is_ai_generated || false,
                ai_confidence: flaggedFile.confidence,
                is_irrelevant: flaggedFile.is_irrelevant || false,
                irrelevance_score: flaggedFile.irrelevance_score,
            };
        });
        setFileFlags(newFlags);
        setShowAIConfirmModal(false);
        setApiStatus("idle");
        setSubmitProgress(0);
    };

    const handleAIContinueAnyways = () => { // For /upload-job
        setShowAIConfirmModal(false);
        let consentAI = false;
        let consentIrrelevant = false;

        // Determine if consent is now being given for AI or Irrelevant files from the modal
        flaggedAIData.forEach(file => {
            if (file.is_ai_generated) consentAI = true;
            if (file.is_irrelevant) consentIrrelevant = true;
        });

        setUserConsentedToAIUpload(consentAI);
        setUserConsentedToIrrelevantUpload(consentIrrelevant);
        setTimeout(() => handleFinalSubmit(true), 0); // Pass true to indicate forcing for subsequent call
    };

    const handleConfirmedUpload = async () => {
        setShowAIConfirmModal(false);
        setApiStatus("loading");
        setSubmitProgress(0);

        const formData = new FormData();

        // Append the stored JSON payloads with the CORRECT keys
        formData.append("job_creation_payload_json", pendingJobPayload);
        // === FIX: Use the full key name expected by the backend ===
        formData.append("successful_analysis_payloads_json", JSON.stringify(pendingAnalysisPayloads.successful));
        formData.append("flagged_analysis_payloads_json", JSON.stringify(pendingAnalysisPayloads.flagged));
        // ==========================================================
        formData.append("user_time_zone", pendingUserTimeZone);

        // Re-append the original File objects
        const allPayloads = [...pendingAnalysisPayloads.successful, ...pendingAnalysisPayloads.flagged];
        const filesToUpload = fileState.selectedFiles.filter(file =>
            allPayloads.some(payload => payload.fileName === file.name)
        );

        filesToUpload.forEach(file => {
            formData.append("files", file);
        });

        try {
            const response = await fetch(`${API_URL}/api/jobs/create-job-with-confirmed-cvs`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                // === FIX: Improved error handling to show detailed messages ===
                const errorData = await response.json().catch(() => ({ detail: "Confirmed upload failed with a non-JSON error." }));
                let errorMessage = errorData.detail;

                // FastAPI validation errors are often in a nested 'detail' array
                if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail.map(err => `${err.loc.join(' -> ')}: ${err.msg}`).join('; ');
                }
                throw new Error(errorMessage || 'An unknown error occurred during the confirmed upload.');
                // ================================================================
            }

            const responseData = await response.json();
            // Handle success (your existing logic is fine here)
            setSubmitProgress(100);
            setTimeout(() => { setApiStatus("success"); setShowSuccessModal(true); }, 1000);

        } catch (error) {
            // The improved error from the 'throw' above will now be displayed
            setApiStatus("error");
            setErrorMessage(error.message);
            setShowErrorModal(true);
        }
    };

    // NEW: Handlers for Duplicate Modal
    const handleCloseDuplicatesModal = (action) => {
        if (action === 'closeAll') {
            fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
            handleCreateMoreJob(); // Reset everything
        } else {
            fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
        }
    };

    const handleUploadNonDuplicatesFromModal = async () => {
        fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
        if (!fileState.nonDuplicateFiles || fileState.nonDuplicateFiles.length === 0) {
            handleCreateMoreJob(); // No files left to upload, just reset
            return;
        }
        // Re-trigger the submission process with only the non-duplicate files
        handleFinalSubmit(false, fileState.nonDuplicateFiles);
    };


    const generateAndCheckDetailedProfiles = async (candidateIds) => {
        console.log("Generating detailed profiles for candidates:", candidateIds);
        if (!candidateIds || candidateIds.length === 0) return { processedCount: 0, failedCount: 0 };
        const totalCandidates = candidateIds.length; let processedCount = 0; let failedCount = 0; const batchSize = 2;
        for (let i = 0; i < candidateIds.length; i += batchSize) {
            const batch = candidateIds.slice(i, i + batchSize);
            await Promise.all(batch.map(async (candidateId) => {
                try {
                    const detailResponse = await fetch(`http://localhost:8000/api/candidates/detail/${candidateId}`);
                    if (!detailResponse.ok) throw new Error(`Failed to generate profile for candidate ${candidateId}`);
                    processedCount++;
                    setSubmitProgress(prev => Math.min(prev + (7 / totalCandidates), 99));
                } catch (error) { failedCount++; console.error(`Error generating profile for candidate ${candidateId}:`, error); }
            }));
            if (i + batchSize < candidateIds.length) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log(`Profile generation complete. Success: ${processedCount}, Failed: ${failedCount}`);
        return { processedCount, failedCount };
    };

    // MODIFIED: Main submission logic to handle exceptions
    const handleFinalSubmit = async (forceUpload = false, filesToUpload = fileState.selectedFiles) => {
        if (!filesToUpload || filesToUpload.length === 0) {
            setErrorMessage("Please upload at least one CV file");
            setShowErrorModal(true);
            return;
        }

        setShowAIConfirmModal(false);
        setShowErrorModal(false);

        try {
            if (progressAnimationRef.current) cancelAnimationFrame(progressAnimationRef.current);
            setApiStatus("loading");
            setSubmitProgress(0);
            await new Promise(resolve => setTimeout(resolve, 400));

            const formData = new FormData();
            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const submissionData = { ...jobData, skills: jobData.skills || [], requiredSkills: jobData.requiredSkills || jobData.skills || [] };
            formData.append("job_data", JSON.stringify(submissionData));
            formData.append("user_time_zone", userTimeZone);
            filesToUpload.forEach(file => formData.append("files", file));

            if (forceUpload) {
                if (userConsentedToAIUpload) formData.append("force_upload_ai_flagged", "true");
                if (userConsentedToIrrelevantUpload) formData.append("force_upload_irrelevant", "true");
            }

            let lastUpdateTime = Date.now();
            const simulateProgress = () => {
                if (apiStatus !== "loading") return;
                const now = Date.now();
                if (now - lastUpdateTime >= 800) {
                    setSubmitProgress(prev => Math.min(prev + (Math.random() * 1.5), 90));
                    lastUpdateTime = now;
                }
                progressAnimationRef.current = requestAnimationFrame(simulateProgress);
            };
            progressAnimationRef.current = requestAnimationFrame(simulateProgress);

            const response = await fetch(API_ENDPOINT, { method: 'POST', body: formData });
            if (progressAnimationRef.current) cancelAnimationFrame(progressAnimationRef.current);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));

                if (response.status === 422 && errorData.error_type === "FLAGGED_CONTENT_NEW_JOB") {
                    console.log("Flagged content detected. Preparing for user confirmation modal.");

                    // Set ALL the state needed for the next step.
                    setFlaggedAIData(errorData.flagged_files_for_modal || []);
                    setPendingAnalysisPayloads({
                        successful: errorData.successful_analysis_payloads || [],
                        flagged: errorData.flagged_analysis_payloads || []
                    });
                    setPendingJobPayload(errorData.job_creation_payload_json);
                    setPendingUserTimeZone(errorData.user_time_zone || "UTC");

                    // Show the modal and stop everything else.
                    setShowAIConfirmModal(true);
                    setApiStatus("idle");
                    setSubmitProgress(0);

                    // Use 'return' to exit the function gracefully. DO NOT THROW.
                    return;
                }
             // For all OTHER errors, we throw so they can be caught by the catch block.
            throw { name: "APIError", status: response.status, data: errorData, message: errorData.message || JSON.stringify(errorData.detail) || `HTTP error ${response.status}` };
        }

        // If successful (201 Created)
        const responseData = await response.json();
        setPendingJobPayload(null); // Clear pending data
        setPendingAnalysisPayloads({ successful: [], flagged: [] });

        if (responseData.successfulCandidates && responseData.successfulCandidates.length > 0) {
            setSubmitProgress(92);
            await generateAndCheckDetailedProfiles(responseData.successfulCandidates);
        }
        setSubmitProgress(100);
        setTimeout(() => { setApiStatus("success"); setShowSuccessModal(true); }, 1000);

    } catch (error) {
        // This will now only catch REAL submission errors.
        if (progressAnimationRef.current) cancelAnimationFrame(progressAnimationRef.current);
        console.error("Error submitting job:", error);
        let displayErrorMessage = "An error occurred. Please try again.";
        if (error.data?.message) displayErrorMessage = error.data.message;
        else if (error.message && !error.message.toLowerCase().includes("http error")) displayErrorMessage = error.message;
        else if (error.status) displayErrorMessage = `HTTP error ${error.status}`;
        
        setApiStatus("error");
        setErrorMessage(displayErrorMessage);
        setShowErrorModal(true);
    }
};


const handleCGPAInputChange = (e) => { if (!isCgpaApplicable) return; const inputValue = e.target.value; if (inputValue === "") { setCgpaInputValue(""); setCgpaError(true); return; } if (!/^\d*\.?\d*$/.test(inputValue)) { return; } setCgpaInputValue(inputValue); const numValue = parseFloat(inputValue); if (!isNaN(numValue) && numValue >= 0 && numValue <= 4) { setMinimumCGPA(numValue); setCgpaError(false); updateSliderPercentage(numValue); } else { setCgpaError(true); } };
const handleCGPABlur = () => { if (cgpaError || cgpaInputValue === "") { setCgpaInputValue(minimumCGPA.toFixed(2)); setCgpaError(false); } else { setCgpaInputValue(parseFloat(cgpaInputValue).toFixed(2)); } };
const handleCGPASliderChange = (e) => { if (!isCgpaApplicable) return; const newValue = parseFloat(e.target.value); setMinimumCGPA(newValue); setCgpaInputValue(newValue.toFixed(2)); setCgpaError(false); updateSliderPercentage(newValue); };
const handleJobDescriptionChange = (e) => setJobDescription(e.target.value);
const handleRequirementsChange = (e) => setRequirements(e.target.value);
const updateSliderPercentage = (value) => { if (!isCgpaApplicable) { const sliderElement = document.getElementById('cgpa'); if (sliderElement) { sliderElement.style.setProperty('--slider-percentage', '0%'); } return; } const percentage = (value / 4) * 100; const sliderElement = document.getElementById('cgpa'); if (sliderElement) { sliderElement.style.setProperty('--slider-percentage', `${percentage}%`); } };
useEffect(() => { if (isCgpaApplicable) { updateSliderPercentage(minimumCGPA); } else { const sliderElement = document.getElementById('cgpa'); if (sliderElement) { sliderElement.style.setProperty('--slider-percentage', '0%'); } } }, [minimumCGPA, isCgpaApplicable]);
const handleJobDescriptionInput = (e) => { const target = e.target.closest('.bias-highlighting-input'); if (target) { target.style.height = "auto"; target.style.height = `${target.scrollHeight}px`; } };
const handleCreateMoreJob = () => { setCurrentStep("jobDetails"); setJobTitle(""); setJobDescription(""); setRequirements(""); setDepartments([]); setMinimumCGPA(2.50); setCgpaInputValue("2.50"); setIsCgpaApplicable(true); setSkills([]); setJobData(null); fileDispatch({ type: 'RESET' }); setApiStatus("idle"); setSubmitProgress(0); setShowSuccessModal(false); setFileFlags({}); setUserConsentedToAIUpload(false); setUserConsentedToIrrelevantUpload(false); };
const toggleCgpaApplicability = () => { if (isCgpaApplicable) { setIsCgpaApplicable(false); setCgpaInputValue("N/A"); setMinimumCGPA(null); setTimeout(() => { const sliderElement = document.getElementById('cgpa'); if (sliderElement) { sliderElement.style.setProperty('--slider-percentage', '0%'); } }, 0); } else { setIsCgpaApplicable(true); setMinimumCGPA(2.50); setCgpaInputValue("2.50"); setTimeout(() => { const sliderElement = document.getElementById('cgpa'); if (sliderElement) { const percentage = (2.50 / 4) * 100; sliderElement.style.setProperty('--slider-percentage', `${percentage}%`); } }, 0); } };
useEffect(() => { if (Object.keys(biasResults).length > 0 || Object.values(biasedTerms).some(terms => terms.length > 0)) { console.log("Bias detected, updating highlights..."); } else { console.log("No bias detected, clearing highlights..."); } }, [biasResults, biasedTerms]);

return (
    <div className="app-container">
        {getFullPageOverlay()}

        {apiStatus === "loading" && (
            <div className="api-loading-overlay">
                <div className="api-loading-content">
                    <LoadingAnimation />
                    <p>Submitting job and uploading files...</p>
                    <div className="progress-bar-container">
                        <div className="progress-bar" style={{ width: `${submitProgress}%` }}></div>
                        <span className="progress-text">{Math.round(submitProgress)}%</span>
                    </div>
                </div>
            </div>
        )}

        {showSuccessModal && <SuccessModal />}
        {showErrorModal && <ErrorModal />}
        {showBiasModal && <BiasDetectionModal isOpen={showBiasModal} onClose={() => setShowBiasModal(false)} biasResults={biasResults} biasedTerms={biasedTerms} />}
        <JobSuggestionModal isOpen={showSuggestionModal} onClose={handleCloseSuggestionModal} onSubmit={handleGenerateSuggestions} jobTitle={jobTitle} isLoading={isGeneratingSuggestions} />

        {/* MODIFIED: Render modals conditionally */}
        <AIConfirmationModal
            isOpen={showAIConfirmModal}
            onReview={handleAIReviewCVs}
            onContinue={handleConfirmedUpload}
            flaggedFiles={flaggedAIData}
            isLoading={apiStatus === "loading"}
            onClose={() => { setShowAIConfirmModal(false); handleAIReviewCVs(); }}
        />
        <DuplicateFilesModal
            isOpen={fileState.showDuplicatesModal}
            duplicates={fileState.duplicateFiles}
            onClose={(action) => handleCloseDuplicatesModal(action)}
            onProceed={() => { /* "Proceed" is disabled for new job creation flow */ }}
            onUploadNonDuplicates={handleUploadNonDuplicatesFromModal}
            nonDuplicateCount={fileState.nonDuplicateFiles ? fileState.nonDuplicateFiles.length : 0}
        />


        {currentStep === "jobDetails" ? (
            <div className="job-container">
                <h3 className="job-title-header">Create New Job</h3>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="jobTitle" className="form-label">Job Title <span className="required">*</span></label>
                        <div className="suggestion-container">
                            <BiasHighlightingInput id="jobTitle" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Enter job title" biasedTerms={biasedTerms.jobTitle || []} multiline={false} aria-required="true" />
                            {showJobTitleSuggestions && (<ul className="suggestions-list">{jobTitleSuggestions.map((suggestion, index) => (<li key={index} onMouseDown={(e) => { e.preventDefault(); handleJobTitleSelect(suggestion); }}>{suggestion}</li>))}</ul>)}
                        </div>
                        <button type="button" onClick={handleOpenSuggestionModal} className="suggest-button" disabled={isGeneratingSuggestions} title="Generate Description & Requirements suggestions based on Job Title">
                            {isGeneratingSuggestions ? 'Generating...' : 'Suggest Job Details (AI)'}
                            <svg className="suggest-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5A.75.75 0 0110 3zM8.707 13.707a1 1 0 11-1.414-1.414L8.586 11H7a1 1 0 110-2h1.586l-1.293-1.293a1 1 0 111.414-1.414L11.414 10l-2.707 2.707zM10 18a8 8 0 100-16 8 8 0 000 16z" clipRule="evenodd" /></svg>
                        </button>
                    </div>
                    {generatedSuggestions && (<div className={`suggestion-display ${showGeneratedSuggestions ? 'expanded' : 'collapsed'}`}><button type="button" onClick={toggleSuggestionDisplay} className="suggestion-toggle-button">{showGeneratedSuggestions ? 'Hide' : 'Show'} AI Suggestions<svg className={`toggle-icon ${showGeneratedSuggestions ? 'up' : 'down'}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button><div className="suggestion-content"><div className="suggestion-section"><h4>Suggested Description:</h4><pre className="suggestion-text">{generatedSuggestions.description}</pre><button type="button" onClick={() => handleApplySuggestion('description')} className="apply-suggestion-button">Apply Description</button></div><div className="suggestion-section"><h4>Suggested Requirements:</h4><pre className="suggestion-text">{generatedSuggestions.requirements}</pre><button type="button" onClick={() => handleApplySuggestion('requirements')} className="apply-suggestion-button">Apply Requirements</button></div><button type="button" onClick={() => handleApplySuggestion('both')} className="apply-suggestion-button both">Apply Both</button></div></div>)}
                    <div className="form-group"><label htmlFor="jobDescription" className="form-label">Description</label><div className="bias-highlighting-input-container"><BiasHighlightingInput id="jobDescription" value={jobDescription} onChange={handleJobDescriptionChange} onInput={handleJobDescriptionInput} placeholder="Enter job description (or use AI Suggest)" biasedTerms={biasedTerms.jobDescription || []} multiline={true} /></div></div>
                    <div className="form-group"><label htmlFor="requirements" className="form-label">Requirements / Qualifications</label><div className="bias-highlighting-input-container"><BiasHighlightingInput id="requirements" value={requirements} onChange={handleRequirementsChange} onInput={handleRequirementsInput} placeholder="Enter job requirements and qualifications (or use AI Suggest)" biasedTerms={biasedTerms.requirements || []} multiline={true} /></div></div>
                    <div className="form-group"><label htmlFor="department" className="form-label">Department</label><div className="suggestion-container"><div className="input-group"><input type="text" id="department" className="form-input" value={departmentInput} onChange={(e) => setDepartmentInput(e.target.value)} onKeyPress={handleDepartmentKeyPress} placeholder="Enter a department" /><button type="button" className="add-button" onClick={handleAddDepartment} disabled={!departmentInput.trim()}>Add</button></div>{showDepartmentSuggestions && (<ul className="suggestions-list">{departmentSuggestions.map((suggestion, index) => (<li key={index} onMouseDown={(e) => { e.preventDefault(); handleDepartmentSelect(suggestion); }}>{suggestion}</li>))}</ul>)}</div>{departments.length > 0 && (<div className="tags-container">{departments.map((department, index) => (<div key={index} className="tag">{department}<button type="button" className="tag-remove" onClick={() => removeDepartment(department)}>×</button></div>))}</div>)}{departments.length > 0 && (biasedTerms.departments || []).length > 0 && (<div className="bias-feedback"><p>Potentially biased terms:</p><ul>{(biasedTerms.departments || []).map((term, index) => (<li key={index}>{term}</li>))}</ul></div>)}</div>
                    <div className="form-group"><label htmlFor="cgpa" className="form-label">Minimum CGPA</label><div className="cgpa-container"><input type="range" id="cgpa" min="0" max="4" step="0.01" value={isCgpaApplicable ? minimumCGPA : 0} onChange={handleCGPASliderChange} className={`cgpa-slider ${!isCgpaApplicable ? 'disabled' : ''}`} aria-valuemin="0" aria-valuemax="4" aria-valuenow={isCgpaApplicable ? minimumCGPA : 0} aria-labelledby="cgpa-value" disabled={!isCgpaApplicable} /><input id="cgpa-value" type="text" className={`cgpa-value ${cgpaError ? 'error' : ''} ${!isCgpaApplicable ? 'disabled' : ''}`} value={cgpaInputValue} onChange={handleCGPAInputChange} onBlur={handleCGPABlur} aria-label="CGPA value" aria-invalid={cgpaError} disabled={!isCgpaApplicable} /><button type="button" className={`na-button ${!isCgpaApplicable ? 'active' : ''}`} onClick={toggleCgpaApplicability}>Not Applicable</button></div>{cgpaError && (<p className="error-message" role="alert">Please enter a valid CGPA between 0 and 4</p>)}</div>
                    <div className="form-group"><label htmlFor="skills" className="form-label">Required Skills <span className="required">*</span></label><div className="suggestion-container"><div className="input-group"><input type="text" id="skills" className="form-input" value={skillInput} onChange={(e) => setSkillInput(e.target.value)} onKeyPress={handleSkillKeyPress} placeholder="Enter a skill" /><button type="button" className="add-button" onClick={handleAddSkill} disabled={!skillInput.trim()}>Add</button></div>{showSkillSuggestions && (<ul className="suggestions-list">{skillSuggestions.map((suggestion, index) => (<li key={index} onClick={() => handleSkillSelect(suggestion)}>{suggestion}</li>))}</ul>)}</div>{skills.length > 0 && (<div className="tags-container">{skills.map((skill, index) => (<div key={`uploadcv-skill-${index}-${skill}`} className="tag"><SkillTagWithLogo skillName={skill} unstyled={true}><button type="button" className="tag-remove" onClick={() => removeSkill(skill)} aria-label={`Remove skill ${skill}`}>×</button></SkillTagWithLogo></div>))}</div>)}{skills.length > 0 && (biasedTerms.requiredSkills || []).length > 0 && (<div className="bias-feedback"><p>Potentially biased terms in Required Skills:</p><ul>{(biasedTerms.requiredSkills || []).map((term, index) => (<li key={index}>{term}</li>))}</ul></div>)}</div>
                    <div className="form-actions"><button type="submit" className="submit-button" disabled={isCheckingBias}>{isCheckingBias ? 'Checking for Bias...' : 'Next'}</button></div>
                </form>
            </div>
        ) : (
            <>
                <div className="step-header">
                    <div className="step-nav"><button onClick={handleBackToJobDetails} className="back-button"><svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>Back to Job Details</button></div>
                    <h3 className="job-title-header">Upload Candidate CVs for {jobData?.jobTitle}</h3>
                </div>
                <div className="upload-container" ref={uploadContainerRef}>
                    <div className="upload-card"><div className="upload-dropzone-container"><div className={`upload-dropzone ${(fileState.isLoading || fileState.processingFiles) ? 'disabled-dropzone' : ''}`} onDragOver={handleDragOver} onDrop={handleDrop} role="button" tabIndex={fileState.isLoading || fileState.processingFiles ? -1 : 0} aria-label="Upload files by dropping them here or press to select files" aria-disabled={fileState.isLoading || fileState.processingFiles} onKeyDown={handleFileInputKeyDown}><div className="upload-icon-container"><svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg></div><p className="upload-text">{(fileState.isLoading || fileState.processingFiles) ? "Please wait for the current upload to complete" : "Drag and Drop files to upload"}</p><input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" multiple onChange={handleFileChange} className="hidden-input" disabled={fileState.isLoading || fileState.processingFiles} /><button className={`browse-button ${(fileState.isLoading || fileState.processingFiles) ? 'disabled-button' : ''}`} onClick={handleChooseFile} disabled={fileState.isLoading || fileState.processingFiles}>{(fileState.isLoading || fileState.processingFiles) ? "Upload in Progress..." : "Browse Files"}</button><p className="upload-subtext">Supports PDF, DOC, DOCX</p></div></div></div>
                </div>
                <div className="files-container">
                    <h3 className="files-title" id="uploaded-files-heading">Uploaded Files</h3>
                    {fileState.selectedFiles.length === 0 ? (<div className="no-files"><p className="no-files-text">No files uploaded yet</p></div>) : (
                        <div className="files-list" role="list" aria-labelledby="uploaded-files-heading">
                            {fileState.selectedFiles.map((file, index) => {
                                // NEW: Check file flags
                                const flags = fileFlags[file.name] || {};
                                const isAI = flags.is_ai_generated;
                                const isIrrelevant = flags.is_irrelevant;
                                const irrelevanceScore = flags.irrelevance_score;
                                const aiConfidence = flags.ai_confidence;
                                let fileItemClasses = "file-item";
                                if (isIrrelevant) fileItemClasses += " irrelevant-item-highlight";
                                else if (isAI) fileItemClasses += " ai-item-highlight";

                                return (
                                    <div key={index} className={fileItemClasses} role="listitem">
                                        <div className="file-content">
                                            {getFileIcon(file.name)}
                                            <div className="file-details">
                                                <div className="file-header">
                                                    <p className="file-name" title={file.name}>{file.name.length > 100 ? file.name.substring(0, 100) + '...' : file.name}</p>
                                                    {/* NEW: Badges container */}
                                                    <div className="badges-main-list">
                                                        {isAI && (
                                                            <span className="badge-main-list ai-badge-main-list">
                                                                AI Detected {aiConfidence ? `(${(aiConfidence * 100).toFixed(0)}%)` : ''}
                                                            </span>
                                                        )}
                                                        {isIrrelevant && (
                                                            <span className="badge-main-list irrelevant-badge-main-list">
                                                                {irrelevanceScore !== undefined && irrelevanceScore !== null ? `${irrelevanceScore.toFixed(0)}% Irrelevant` : "Irrelevant"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button onClick={() => removeFile(index)} className="delete-button" aria-label={`Remove file ${file.name}`} disabled={fileState.isLoading || fileState.processingFiles}><svg className="delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
                                                </div>
                                                {(fileState.isLoading && fileState.uploadProgress[file.name] !== undefined && fileState.uploadProgress[file.name] < 100) ? (<div className="progress-bar-container"><div className="progress-bar" style={{ width: `${fileState.uploadProgress[file.name]}%` }}></div><span className="progress-text">{fileState.uploadProgress[file.name]}%</span></div>) : (fileState.processingFiles && fileState.uploadProgress[file.name] === undefined && fileState.uploadQueue && fileState.uploadQueue.some(queueFile => queueFile.name === file.name)) ? (<div className="waiting-container"><p className="waiting-text">Waiting to upload...</p></div>) : (<p className="file-size">{(file.size / 1024).toFixed(1)} KB</p>)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <div className="final-submit-container">
                        <button onClick={() => handleFinalSubmit(false)} className="submit-button final-submit" disabled={fileState.isLoading || fileState.processingFiles || apiStatus === "loading" || fileState.selectedFiles.length === 0}>
                            {fileState.isLoading || fileState.processingFiles ? 'Uploading Files...' : apiStatus === "loading" ? 'Submitting...' : 'Submit Job Details and CV'}
                        </button>
                    </div>
                </div>
            </>
        )}
        <JobSuggestionModal isOpen={showSuggestionModal} onClose={handleCloseSuggestionModal} onSubmit={handleGenerateSuggestions} jobTitle={jobTitle} isLoading={isGeneratingSuggestions} />
    </div>
);
};

export default UploadCV;
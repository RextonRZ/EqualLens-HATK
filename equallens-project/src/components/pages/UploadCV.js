import React, { useState, useRef, useEffect, useCallback, useMemo, useReducer } from "react";
import "./UploadCV.css";
import AIConfirmationModal from '../AIConfirmationModal.js';
import "../pageloading.css"; // Import the loading animation CSS

// Add these imports at the top
import BiasDetectionModal from '../BiasDetectionModal';
import BiasHighlightingInput from '../BiasHighlightingInput';
import JobSuggestionModal from '../JobSuggestionModal';
import SkillTagWithLogo from '../SkillTagWithLogo';

// File upload reducer to manage file upload state more efficiently
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
            return {
                ...state,
                isLoading: true
            };
        case 'FILE_COMPLETE':
            return {
                ...state,
                uploadQueue: state.uploadQueue.slice(1)
            };
        case 'QUEUE_COMPLETE':
            return {
                ...state,
                isLoading: false,
                processingFiles: false
            };
        case 'REMOVE_FILE':
            const fileToRemove = state.selectedFiles[action.payload.index];
            return {
                ...state,
                selectedFiles: state.selectedFiles.filter((_, i) => i !== action.payload.index),
                uploadQueue: fileToRemove ?
                    state.uploadQueue.filter(queueFile => queueFile.name !== fileToRemove.name) :
                    state.uploadQueue,
                uploadProgress: fileToRemove ?
                    // Remove the progress entry for this file
                    Object.fromEntries(
                        Object.entries(state.uploadProgress).filter(([key]) => key !== fileToRemove.name)
                    ) :
                    state.uploadProgress
            };
        case 'RESET':
            return {
                selectedFiles: [],
                isLoading: false,
                uploadProgress: {},
                uploadQueue: [],
                processingFiles: false
            };
        default:
            return state;
    }
};

const UploadCV = () => {
    // Use reducer for file upload state management
    const [fileState, fileDispatch] = useReducer(fileUploadReducer, {
        selectedFiles: [],
        isLoading: false,
        uploadProgress: {},
        uploadQueue: [],
        processingFiles: false
    });

    const [currentStep, setCurrentStep] = useState("jobDetails"); // "jobDetails" or "uploadCV"
    const [jobData, setJobData] = useState(null); // To store submitted job details

    // Add API state variables
    const [apiStatus, setApiStatus] = useState("idle"); // idle, loading, success, error
    const [submitProgress, setSubmitProgress] = useState(0); // Track overall submission progress

    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    const uploadContainerRef = useRef(null);

    // Create animation frame reference at the component level
    const progressAnimationRef = useRef(null);

    // Job details state
    const [jobTitle, setJobTitle] = useState("");
    const [jobTitleSuggestions, setJobTitleSuggestions] = useState([]);
    const [showJobTitleSuggestions, setShowJobTitleSuggestions] = useState(false);
    const [jobDescription, setJobDescription] = useState("");
    const [requirements, setRequirements] = useState(""); // Add this new state variable
    const [departments, setDepartments] = useState([]);
    const [departmentInput, setDepartmentInput] = useState("");
    const [departmentSuggestions, setDepartmentSuggestions] = useState([]);
    const [showDepartmentSuggestions, setShowDepartmentSuggestions] = useState(false);
    const [minimumCGPA, setMinimumCGPA] = useState(2.50);
    const [cgpaInputValue, setCgpaInputValue] = useState("2.50");
    const [cgpaError, setCgpaError] = useState(false);
    const [isCgpaApplicable, setIsCgpaApplicable] = useState(true); // Track if CGPA is applicable
    const [skillInput, setSkillInput] = useState("");
    const [skillSuggestions, setSkillSuggestions] = useState([]);
    const [showSkillSuggestions, setShowSkillSuggestions] = useState(false);
    const [skills, setSkills] = useState([]);
    const [aiFlaggedFiles, setAIFlaggedFiles] = useState([]);

    // Sample data for suggestions - wrapped in useMemo to avoid recreation on each render
    const jobTitleOptions = useMemo(() => [
        "Software Engineer", "Data Scientist", "Project Manager", "Web Developer",
        "UI/UX Designer", "Product Manager", "DevOps Engineer", "Systems Analyst",
        "Frontend Developer", "Backend Developer", "Full Stack Developer",
        "Machine Learning Engineer", "Business Analyst", "Quality Assurance Engineer"
    ], []);

    const departmentOptions = useMemo(() => [
        "Engineering", "Information Technology", "Marketing", "Finance", "Human Resources",
        "Sales", "Operations", "Customer Support", "Research & Development", "Legal",
        "Administration", "Design", "Product Management", "Business Development", "Data Science"
    ], []);

    const skillsOptions = useMemo(() => [
        "JavaScript", "Python", "Java", "React", "Node.js", "SQL", "AWS", "Docker",
        "DevOps", "Machine Learning", "Data Analysis", "Agile", "Scrum",
        "Project Management", "UI/UX Design", "TypeScript", "Go", "Ruby",
        "Communication", "Leadership", "Problem Solving", "C#", "PHP", "Angular",
        "Vue.js", "MongoDB", "GraphQL", "REST API", "Git"
    ], []);

    // Add these state variables after other useState declarations
    const [showBiasModal, setShowBiasModal] = useState(false);
    const [biasResults, setBiasResults] = useState({}); // Stores the explanation { field: explanation }
    const [biasedTerms, setBiasedTerms] = useState({
        jobTitle: [],
        jobDescription: [],
        requirements: [],
        requiredSkills: [],
        departments: []
    });
    const [isCheckingBias, setIsCheckingBias] = useState(false);
    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [suggestionContext, setSuggestionContext] = useState({
        core_responsibilities: "",
        key_skills: "",
        company_culture: "",
        experience_level: ""
    });
    const [generatedSuggestions, setGeneratedSuggestions] = useState(null); // { description: '...', requirements: '...' }
    const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
    const [showGeneratedSuggestions, setShowGeneratedSuggestions] = useState(false); // To control collapsible display

    const handleOpenSuggestionModal = () => {
        setShowSuggestionModal(true);
    };

    const handleCloseSuggestionModal = () => {
        setShowSuggestionModal(false);
        setIsGeneratingSuggestions(false); // Reset loading state if modal is closed
    };

    const handleGenerateSuggestions = async (contextData) => {
        if (!jobTitle.trim()) {
            alert("Please enter a Job Title before generating suggestions.");
            return;
        }
        setIsGeneratingSuggestions(true);
        setGeneratedSuggestions(null); // Clear previous suggestions
        setShowGeneratedSuggestions(false); // Collapse section

        try {
            const response = await fetch('http://localhost:8000/api/jobs/suggest-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_title: jobTitle,
                    ...contextData // Spread the context from the modal
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: "Unknown error generating suggestions" }));
                throw new Error(errorData.detail || `HTTP error ${response.status}`);
            }

            const suggestions = await response.json();
            setGeneratedSuggestions(suggestions);
            setShowGeneratedSuggestions(true); // Show suggestions automatically
            handleCloseSuggestionModal(); // Close modal on success

        } catch (error) {
            console.error("Error generating suggestions:", error);
            alert(`Failed to generate suggestions: ${error.message}`);
            // Keep modal open on error? Or close? Let's close it.
            handleCloseSuggestionModal();
        } finally {
            setIsGeneratingSuggestions(false);
        }
    };

    const handleApplySuggestion = (type) => {
        if (!generatedSuggestions) return;

        if (type === 'description' || type === 'both') {
            setJobDescription(generatedSuggestions.description);
            // Trigger resize for textarea if needed
            const descElement = document.getElementById("jobDescription");
            if (descElement) {
                // Use timeout to ensure state update is rendered before calculating height
                setTimeout(() => {
                    descElement.style.height = "auto";
                    descElement.style.height = `${descElement.scrollHeight}px`;
                }, 0);
            }
        }
        if (type === 'requirements' || type === 'both') {
            setRequirements(generatedSuggestions.requirements);
            // Trigger resize for textarea if needed
            const reqElement = document.getElementById("requirements");
            if (reqElement) {
                setTimeout(() => {
                    reqElement.style.height = "auto";
                    reqElement.style.height = `${reqElement.scrollHeight}px`;
                }, 0);
            }
        }
        // Close modal
        setShowSuggestionModal(false);
        setShowGeneratedSuggestions(false);
    };

    const toggleSuggestionDisplay = () => {
        setShowGeneratedSuggestions(prev => !prev);
    };

    // Add auto-resize for requirements textarea too
    const handleRequirementsInput = (e) => {
        const target = e.target.closest('.bias-highlighting-input');
        if (target) {
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
        }
    };

    const analyzeBias = async () => {
        setIsCheckingBias(true);
        setBiasResults({}); // Clear previous results
        setBiasedTerms({ // Clear previous terms
            jobTitle: [],
            jobDescription: [],
            requirements: [],
            requiredSkills: [],
            departments: []
        });

        try {
            const requestBody = {
                jobTitle,
                jobDescription,
                requirements, // <<< SEND requirements SEPARATELY
                departments,
                requiredSkills: skills,
                // Send CGPA only if applicable, otherwise maybe omit or send null?
                // The backend model currently expects optional float, 0 is okay.
                minimumCGPA: isCgpaApplicable ? minimumCGPA : null
            };
            console.log("Sending to bias analysis:", requestBody); // Log what's being sent

            const response = await fetch('http://localhost:8000/api/bias-detection/analyze', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: "Unknown bias analysis error" }));
                // Log the error response from the server
                console.error("Bias analysis API error response:", errorData);
                throw new Error(errorData.detail || `Bias analysis failed with status ${response.status}`);
            }

            const data = await response.json();
            console.log("Bias analysis response data:", data); // Log the received data

            // Use the validated/cleaned data from the backend response
            const receivedBiasedFields = data.biasedFields || {};
            const receivedBiasedTerms = data.biasedTerms || {};

            // Update state with potentially separated results
            setBiasResults(receivedBiasedFields);
            setBiasedTerms({
                jobTitle: receivedBiasedTerms.jobTitle || [],
                jobDescription: receivedBiasedTerms.jobDescription || [],
                requirements: receivedBiasedTerms.requirements || [], // <<< MAP requirements
                requiredSkills: receivedBiasedTerms.requiredSkills || [],
                departments: receivedBiasedTerms.departments || []
            });

            setIsCheckingBias(false);

            // Show modal if bias is detected based on the API's 'hasBias' flag or presence of results
            if (data.hasBias || Object.keys(receivedBiasedFields).length > 0 || Object.values(receivedBiasedTerms).some(terms => terms.length > 0)) {
                setShowBiasModal(true);
                return true; // Bias detected
            }

            return false; // No bias detected

        } catch (error) {
            console.error("Error analyzing bias:", error);
            alert(`Could not analyze bias: ${error.message}`); // Show error to user
            setIsCheckingBias(false);
            // Decide if you want to proceed despite the error. Usually, you wouldn't.
            // Let's return true to indicate an issue occurred and stop the process.
            // Or return false to allow proceeding anyway (potentially risky).
            // For safety, let's treat analysis failure as a reason to pause.
            return true; // Indicate failure, stop form progression
        }
    };

    // Filter suggestions based on input
    useEffect(() => {
        if (jobTitle) {
            const filtered = jobTitleOptions.filter(
                option => option.toLowerCase().includes(jobTitle.toLowerCase()) // Case-insensitive search
            );
            setJobTitleSuggestions(filtered);
            setShowJobTitleSuggestions(filtered.length > 0);
        } else {
            setShowJobTitleSuggestions(false);
        }
    }, [jobTitle, jobTitleOptions]);

    useEffect(() => {
        if (departmentInput) {
            const filtered = departmentOptions.filter(
                option => option.toLowerCase().includes(departmentInput.toLowerCase())
            );
            setDepartmentSuggestions(filtered);
            setShowDepartmentSuggestions(filtered.length > 0);
        } else {
            setShowDepartmentSuggestions(false);
        }
    }, [departmentInput, departmentOptions]);

    useEffect(() => {
        if (skillInput) {
            const filtered = skillsOptions.filter(
                option => option.toLowerCase().includes(skillInput.toLowerCase())
            );
            setSkillSuggestions(filtered);
            setShowSkillSuggestions(filtered.length > 0);
        } else {
            setShowSkillSuggestions(false);
        }
    }, [skillInput, skillsOptions]);

    // Selectors for job title and skills
    const handleJobTitleSelect = (selected) => {
        setJobTitle(selected);
        setShowJobTitleSuggestions(false);

        // Directly update the BiasHighlightingInput value
        const inputElement = document.getElementById("jobTitle");
        if (inputElement) {
            inputElement.innerText = selected;
        }
    };

    const handleSkillSelect = (selected) => {
        if (!skills.includes(selected)) {
            setSkills([...skills, selected]);
        }
        setSkillInput("");
        setShowSkillSuggestions(false);
    };

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!event.target.closest('.suggestion-container')) {
                setShowJobTitleSuggestions(false);
                setShowSkillSuggestions(false);
                setShowDepartmentSuggestions(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Process files and add to queue - optimized with useCallback and useReducer
    const processFiles = useCallback((files) => {
        // If already processing files, don't allow new uploads
        if (fileState.isLoading || fileState.processingFiles) {
            alert("Please wait for the current file to complete uploading before adding new files.");
            return;
        }

        let updatedFiles = [...fileState.selectedFiles];
        let newFiles = [];

        // Process all files but upload one at a time
        for (const fileToProcess of files) {
            // Check file format
            const extension = fileToProcess.name.split('.').pop().toLowerCase();
            const validExtensions = ['pdf', 'doc', 'docx'];

            if (!validExtensions.includes(extension)) {
                alert(`${fileToProcess.name} is not a supported file type. Please upload PDF, DOC, or DOCX files only.`);
                continue;
            }

            // Check if file with same name exists - log for debugging
            console.log("Checking for duplicate file:", fileToProcess.name);
            const existingIndex = updatedFiles.findIndex(file => file.name === fileToProcess.name);
            console.log("Existing file index:", existingIndex);

            if (existingIndex !== -1) {
                // We need to use a synchronous approach here since we're in a loop
                const confirmReplace = window.confirm(`A file named "${fileToProcess.name}" already exists. Do you want to replace it?`);

                if (confirmReplace) {
                    console.log("Replacing file:", fileToProcess.name);
                    setAIFlaggedFiles(prevFlagged => 
                        prevFlagged.filter(filename => filename !== fileToProcess.name)
                    );
                    // Replace the file in our updated array
                    updatedFiles[existingIndex] = fileToProcess;

                    // Mark this file to be added to the queue
                    newFiles.push(fileToProcess);
                }
            } else {
                console.log("Adding new file:", fileToProcess.name);
                // New file, add it to both arrays
                updatedFiles.push(fileToProcess);
                newFiles.push(fileToProcess);
            }
        }

        if (newFiles.length > 0) {
            console.log("New files to process:", newFiles.map(f => f.name));
            // Filter out any files from the queue that are being replaced
            const newQueue = [
                ...fileState.uploadQueue.filter(queueFile =>
                    !newFiles.some(newFile => newFile.name === queueFile.name)
                ),
                ...newFiles
            ];

            console.log("New upload queue:", newQueue.map(f => f.name));

            fileDispatch({
                type: 'ADD_FILES',
                payload: {
                    updatedFiles,
                    newQueue
                }
            });
        }
    }, [fileState.selectedFiles, fileState.isLoading, fileState.processingFiles, fileState.uploadQueue]);

    // Process upload queue sequentially
    useEffect(() => {
        if (fileState.uploadQueue.length === 0) {
            if (fileState.processingFiles) {
                fileDispatch({ type: 'QUEUE_COMPLETE' });
            }
            return;
        }

        // Process all files at once
        const processAllFiles = async () => {
            // Mark all files as 100% complete immediately
            for (const fileToProcess of fileState.uploadQueue) {
                fileDispatch({
                    type: 'FILE_PROGRESS',
                    payload: { fileName: fileToProcess.name, progress: 100 }
                });
            }

            // Complete all files at once
            fileState.uploadQueue.forEach(() => {
                fileDispatch({ type: 'FILE_COMPLETE' });
            });
        };

        processAllFiles();
    }, [fileState.uploadQueue, fileState.processingFiles]);

    useEffect(() => {
        const uploadContainer = uploadContainerRef.current;

        if (uploadContainer) {
            const handleLocalDragOver = (event) => {
                event.preventDefault();
                uploadContainer.classList.add('dragover');
            };

            const handleLocalDragLeave = () => {
                uploadContainer.classList.remove('dragover');
            };

            const handleLocalDrop = () => {
                uploadContainer.classList.remove('dragover');
            };

            uploadContainer.addEventListener('dragover', handleLocalDragOver);
            uploadContainer.addEventListener('dragleave', handleLocalDragLeave);
            uploadContainer.addEventListener('drop', handleLocalDrop);

            return () => {
                uploadContainer.removeEventListener('dragover', handleLocalDragOver);
                uploadContainer.removeEventListener('dragleave', handleLocalDragLeave);
                uploadContainer.removeEventListener('drop', handleLocalDrop);
            };
        }
    }, []);

    useEffect(() => {
        // Only add document-level event listeners when on the upload CV page
        if (currentStep !== "uploadCV") return;

        const handleDocumentDragOver = (event) => {
            event.preventDefault();
            if (!isDragging && !fileState.isLoading && !fileState.processingFiles) {
                setIsDragging(true);
            }
        };

        const handleDocumentDragLeave = (event) => {
            event.preventDefault();

            if (event.clientX <= 0 || event.clientY <= 0 ||
                event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
                setIsDragging(false);
            }
        };

        const handleDocumentDrop = (event) => {
            event.preventDefault();
            setIsDragging(false);

            // Prevent file drop during loading
            if (fileState.isLoading || fileState.processingFiles) {
                alert("Please wait for the current file to complete uploading before adding new files.");
                return;
            }

            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) {
                processFiles(files);
            }
        };

        document.addEventListener('dragover', handleDocumentDragOver);
        document.addEventListener('dragleave', handleDocumentDragLeave);
        document.addEventListener('drop', handleDocumentDrop);

        return () => {
            document.removeEventListener('dragover', handleDocumentDragOver);
            document.removeEventListener('dragleave', handleDocumentDragLeave);
            document.removeEventListener('drop', handleDocumentDrop);
        };
    }, [isDragging, processFiles, fileState.isLoading, fileState.processingFiles, currentStep]); // Add currentStep to dependencies

    const handleFileChange = (event) => {
        const files = Array.from(event.target.files);
        if (files.length > 0) {
            processFiles(files);
            // Reset the file input so the same file can be selected again
            event.target.value = '';
        }
    };

    const handleDragOver = (event) => {
        event.preventDefault();
        // Only show dragover effect if not currently loading
        if (!fileState.isLoading && !fileState.processingFiles) {
            event.dataTransfer.dropEffect = 'copy';
        } else {
            // Use 'none' to indicate dropping is not allowed
            event.dataTransfer.dropEffect = 'none';
        }
    };

    const handleDrop = (event) => {
        event.preventDefault();
        setIsDragging(false);

        // Prevent file drop during loading
        if (fileState.isLoading || fileState.processingFiles) {
            alert("Please wait for the current file to complete uploading before adding new files.");
            return;
        }

        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            processFiles(files);
        }
    };

    // Add this function to fix the error
    const handleFileInputKeyDown = (e) => {
        // Activate file input on Enter or Space
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current.click();
        }
    };

    // Improved file remove function using reducer
    const removeFile = (index) => {
        // Get the filename before removing it
        const fileToRemove = fileState.selectedFiles[index];
        if (fileToRemove) {
            // Remove from AI flagged files if it was flagged
            setAIFlaggedFiles(prevFlagged => 
                prevFlagged.filter(filename => filename !== fileToRemove.name)
            );
        }
        
        fileDispatch({
            type: 'REMOVE_FILE',
            payload: { index }
        });
    };

    const handleChooseFile = () => {
        fileInputRef.current.click();
    };

    const getFileIcon = (fileName) => {
        const extension = fileName.split('.').pop().toLowerCase();

        switch (extension) {
            case 'pdf':
                return <div className="file-icon pdf-icon">PDF</div>;
            case 'doc':
            case 'docx':
                return <div className="file-icon doc-icon">DOC</div>;
            default:
                return <div className="file-icon default-icon">FILE</div>;
        }
    };

    const getFullPageOverlay = () => {
        if (!isDragging) return null;

        return (
            <div className="fullpage-drop-overlay">
                <div className="drop-content">
                    <div className="file-preview">
                        <div className="file-icon-large pdf-icon-large">FILE</div>
                        {fileState.selectedFiles.length > 0 && <div className="copy-badge">Copy</div>}
                    </div>
                    <h2 className="drop-title">Drop files anywhere</h2>
                    <p className="drop-subtitle">Drop file(s) to upload it</p>
                </div>
            </div>
        );
    };

    // Job details handlers
    const handleAddSkill = () => {
        if (skillInput.trim() && !skills.includes(skillInput.trim())) {
            setSkills([...skills, skillInput.trim()]);
            setSkillInput("");
        }
    };

    const removeSkill = (skill) => {
        setSkills(skills.filter(s => s !== skill));
    };

    const handleSkillKeyPress = (e) => {
        if (e.key === 'Enter' && skillInput.trim()) {
            e.preventDefault();
            handleAddSkill();
        }
    };

    // Department handlers
    const handleDepartmentSelect = (department) => {
        if (!departments.includes(department)) {
            setDepartments([...departments, department]);
        }
        setDepartmentInput("");
        setShowDepartmentSuggestions(false);
    };

    const handleAddDepartment = () => {
        if (departmentInput.trim() && !departments.includes(departmentInput.trim())) {
            setDepartments([...departments, departmentInput.trim()]);
            setDepartmentInput("");
        }
    };

    const handleDepartmentKeyPress = (e) => {
        if (e.key === 'Enter' && departmentInput.trim()) {
            e.preventDefault();
            handleAddDepartment();
        }
    };

    const removeDepartment = (department) => {
        setDepartments(departments.filter(dept => dept !== department));
    };

    const validateForm = () => {
        if (!jobTitle.trim()) {
            alert("Job Title is required");
            return false;
        }

        if (skills.length === 0) {
            alert("At least one Required Skill is required");
            return false;
        }

        return true;
    };

    // When submitting the form, make sure we're using null for N/A CGPA
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (validateForm()) {
            const hasBiasOrError = await analyzeBias();

            if (hasBiasOrError) {
                // If bias detected or error occurred, the modal will be shown or alert displayed by analyzeBias. Stop here.
                return;
            }

            let combinedDescription = jobDescription;
            // Only append requirements if there is any content
            if (requirements && requirements.trim()) {
                // Add two new lines before the requirements section for better formatting
                combinedDescription += "\n\nRequirements/ Qualifications:\n" + requirements;
            }

            // Save job details and move to next step
            const jobDetails = {
                jobTitle,
                jobDescription: combinedDescription, // Use the combined description
                departments,
                minimumCGPA: isCgpaApplicable ? minimumCGPA : null, // Use null for N/A CGPA
                skills,
                requiredSkills: skills
            };

            console.log("Job details saved:", jobDetails);
            setJobData(jobDetails);
            setCurrentStep("uploadCV");

            // Scroll to top of the page
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    // Add handler for going back to job details
    const handleBackToJobDetails = () => {
        setCurrentStep("jobDetails");
        // Scroll to top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Reapply slider fill percentage to fix CGPA slider color issue
        setTimeout(() => {
            updateSliderPercentage(minimumCGPA);
        }, 100);
    };

    // API URL for backend
    const API_URL = "http://localhost:8000"; // Your FastAPI URL
    const API_ENDPOINT = `${API_URL}/api/jobs/upload-job`; // Ensure the correct endpoint is used
    const UPLOAD_MORE_CV_ENDPOINT = `${API_URL}/api/jobs/upload-more-cv`; // Add endpoint for upload-more-cv

    // Clean up animation frame on component unmount
    useEffect(() => {
        return () => {
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }
        };
    }, []);

    // Updated LoadingAnimation component with cleaner structure
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

    // Add state for managing success and error modals
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");

    // Success Modal Component with improved accessibility
    const SuccessModal = () => (
        <div
            className="status-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-modal-title"
        >
            <div className="status-modal success-modal">
                <div className="status-icon success-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 id="success-modal-title" className="status-title">Submission Complete!</h3>
                <p className="status-description">
                    <strong>Your files have been uploaded successfully</strong>
                </p>
                <div className="status-buttons">
                    <button
                        className="status-button secondary-button"
                        onClick={handleCreateMoreJob}
                    >
                        Create More Job
                    </button>
                    <button
                        className="status-button primary-button"
                        onClick={handleGoToDashboard}
                        autoFocus
                    >
                        Go to Dashboard
                    </button>
                </div>
            </div>
        </div>
    );

    // Error Modal Component with improved accessibility
    const ErrorModal = () => (
        <div
            className="status-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="error-modal-title"
        >
            <div className="status-modal error-modal">
                <div className="status-icon error-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </div>
                <h3 id="error-modal-title" className="status-title">Submission Failed!</h3>
                <p className="status-message">{errorMessage || "Please try again"}</p>
                <div className="status-buttons">
                    <button
                        className="status-button primary-button"
                        onClick={handleTryAgain}
                        autoFocus
                    >
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    );

    const handleGoToDashboard = () => {
        // Close the modal first
        setShowSuccessModal(false);

        // Navigate to dashboard page
        window.location.href = "/dashboard";

        // If you're using React Router, you could use navigate instead:
        // navigate("/dashboard");
    };

    const handleTryAgain = () => {
        setShowErrorModal(false);
        // Reset API state for retrying
        setApiStatus("idle");
        setSubmitProgress(0);
    };

    const [showAIConfirmModal, setShowAIConfirmModal] = useState(false);
    const [flaggedAIData, setFlaggedAIData] = useState([]);

    const handleAIReviewCVs = () => {
        setAIFlaggedFiles(flaggedAIData.map(file => file.filename));
        setShowAIConfirmModal(false);
        setApiStatus("idle");
        setSubmitProgress(0);
        // User can now review fileState.selectedFiles and remove/change them
    };

    const handleAIContinueAnyways = () => {
        setShowAIConfirmModal(false); // Close modal first
        handleFinalSubmit(true); // Call with forceUpload = true
    };

    // Updated function to force generate detailed profiles
    const generateAndCheckDetailedProfiles = async (candidateIds) => {
        console.log("Generating detailed profiles for candidates:", candidateIds);
        const totalCandidates = candidateIds.length;
        let processedCount = 0;
        let failedCount = 0;

        // Process candidates in batches to avoid overloading the server
        const batchSize = 2;

        for (let i = 0; i < candidateIds.length; i += batchSize) {
            const batch = candidateIds.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(candidateIds.length / batchSize)}`);

            // Process this batch in parallel
            await Promise.all(batch.map(async (candidateId) => {
                try {
                    console.log(`Explicitly generating detailed profile for candidate ${candidateId}`);

                    // Step 1: Generate the detailed profile using the detail endpoint
                    const detailResponse = await fetch(`http://localhost:8000/api/candidates/detail/${candidateId}`);

                    if (!detailResponse.ok) {
                        throw new Error(`Failed to generate profile for candidate ${candidateId}`);
                    }

                    // Successfully generated profile
                    processedCount++;

                    // Update progress
                    const progressIncrement = 7 * (processedCount / totalCandidates);
                    setSubmitProgress(92 + progressIncrement);

                } catch (error) {
                    failedCount++;
                    console.error(`Error generating profile for candidate ${candidateId}:`, error);
                }
            }));

            // Add a delay between batches to avoid overwhelming the server
            if (i + batchSize < candidateIds.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`Profile generation complete. Success: ${processedCount}, Failed: ${failedCount}`);
        return { processedCount, failedCount };
    };

    const handleFinalSubmit = async (forceUpload = false) => {
        if (!fileState.selectedFiles || fileState.selectedFiles.length === 0) {
            setErrorMessage("Please upload at least one CV file");
            setShowErrorModal(true);
            return;
        }

        // Close AI confirm modal if it was open from a previous attempt
        setShowAIConfirmModal(false);

        try {
            // Cancel any existing animation frame
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }

            setApiStatus("loading");
            setSubmitProgress(0); // Start with 0% progress 

            // Add a small delay to ensure loading animation starts properly
            await new Promise(resolve => setTimeout(resolve, 400));

            // Create form data with both skills and requiredSkills fields
            const formData = new FormData();
            const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            // Add job data as JSON string with both field names to ensure compatibility
            const submissionData = {
                ...jobData,
                // Ensure both field names are present
                skills: jobData.skills || [],
                requiredSkills: jobData.requiredSkills || jobData.skills || []
            };

            formData.append("job_data", JSON.stringify(submissionData));
            formData.append("user_time_zone", userTimeZone);

            // Add all files
            fileState.selectedFiles.forEach(file => {
                formData.append("files", file);
            });

            if (forceUpload) {
                formData.append("force_upload_ai_flagged", "true");
            }

            // Simulate early progress before actual upload starts
            setSubmitProgress(7);

            await new Promise(resolve => setTimeout(resolve, 2750));

            setSubmitProgress(16);

            await new Promise(resolve => setTimeout(resolve, 5450));


            // Simulate some more progress before sending
            setSubmitProgress(30);

            await new Promise(resolve => setTimeout(resolve, 5450));

            setSubmitProgress(65);

            // Function to simulate progress during waiting time - use requestAnimationFrame for smoother updates
            let lastUpdateTime = Date.now();
            const simulateProgress = () => {
                if (apiStatus !== "loading") return; // Stop if no longer loading

                const now = Date.now();
                // Only update every 800ms to reduce rendering load
                if (now - lastUpdateTime >= 800) {
                    setSubmitProgress(prev => {
                        const newProgress = prev + (Math.random() * 1.5);
                        return Math.min(newProgress, 90);
                    });
                    lastUpdateTime = now;
                }
                progressAnimationRef.current = requestAnimationFrame(simulateProgress);
            };

            // Start progress simulation with requestAnimationFrame
            progressAnimationRef.current = requestAnimationFrame(simulateProgress);

            // Send to backend API
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                body: formData,
            });

            // Clear the progress simulation
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (parseError) {
                    const errorText = await response.text();
                    throw new Error(`Server responded with ${response.status}: ${errorText}`);
                }

                if (response.status === 422 && errorData.detail && errorData.detail.error_type === "AI_CONTENT_DETECTED") {
                    setFlaggedAIData(errorData.detail.flagged_files || []);
                    setShowAIConfirmModal(true);
                    setApiStatus("idle");
                    setSubmitProgress(0);
                    return;
                }
                throw { name: "APIError", status: response.status, data: errorData, message: errorData.detail?.message || JSON.stringify(errorData.detail) || `HTTP error ${response.status}` };
            }

            const responseData = await response.json();
            console.log("Upload job server response:", responseData);

            // Set the final progress based on response (or 100 if not provided)
            setSubmitProgress(responseData.progress || 95);

            // UPDATED: Explicitly generate detailed profiles for all candidates
            if (responseData.candidateIds && responseData.candidateIds.length > 0) {
                console.log(`Generating detailed profiles for ${responseData.candidateIds.length} newly uploaded candidates...`);
                setSubmitProgress(92);

                try {
                    const result = await generateAndCheckDetailedProfiles(responseData.candidateIds);
                    console.log(`Profile generation results: ${result.processedCount} successful, ${result.failedCount} failed`);
                } catch (error) {
                    console.warn("Error during profile generation:", error);
                }
            } else {
                console.warn("No candidateIds received in response");
            }

            setSubmitProgress(100);

            // Add a delay to ensure animation completes nicely
            setTimeout(() => {
                setApiStatus("success");

                setShowSuccessModal(true);
            }, 1000);

        } catch (error) {
            // Clear animation frame in case of error too
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }

            console.error("Error submitting job:", error);
            let displayErrorMessage = "An error occurred. Please try again.";

            if (error.name === "APIError" && error.data?.detail) {
                const detail = error.data.detail;
                if (typeof detail === 'string') displayErrorMessage = detail;
                else if (detail.message) displayErrorMessage = detail.message;
                else displayErrorMessage = JSON.stringify(detail);
            } else if (error.message) {
                displayErrorMessage = error.message;
            }

            // Do not show AIConfirmModal here again if it was a general error
            if (!(error.name === "APIError" && error.status === 422 && error.data?.detail?.error_type === "AI_CONTENT_DETECTED")) {
                setApiStatus("error");
                setErrorMessage(displayErrorMessage);
                setShowErrorModal(true); // Your existing generic error modal
            }

            // Reset API status unless AI modal is already up
            if (!showAIConfirmModal) {
                setTimeout(() => {
                    setApiStatus("idle");
                    setSubmitProgress(0);
                }, 1000);
            }
        }
    };

    // Handle direct CGPA input
    const handleCGPAInputChange = (e) => {
        // If CGPA is not applicable, don't allow changes
        if (!isCgpaApplicable) return;

        const inputValue = e.target.value;

        // Allow empty field while typing
        if (inputValue === "") {
            setCgpaInputValue("");
            setCgpaError(true);
            return;
        }

        // Only allow numeric input with decimal point
        if (!/^\d*\.?\d*$/.test(inputValue)) {
            return;
        }

        setCgpaInputValue(inputValue);

        // Validate the input value
        const numValue = parseFloat(inputValue);
        if (!isNaN(numValue) && numValue >= 0 && numValue <= 4) {
            setMinimumCGPA(numValue);
            setCgpaError(false);
            // Update the slider's fill percentage for direct input
            updateSliderPercentage(numValue);
        } else {
            setCgpaError(true);
        }
    };

    // Handle when input field loses focus
    const handleCGPABlur = () => {
        // If the input is invalid or empty, reset to the current valid CGPA
        if (cgpaError || cgpaInputValue === "") {
            setCgpaInputValue(minimumCGPA.toFixed(2));
            setCgpaError(false);
        }
        // Format the value with 2 decimal places when focus is lost
        else {
            setCgpaInputValue(parseFloat(cgpaInputValue).toFixed(2));
        }
    };

    // Update input value when slider changes
    const handleCGPASliderChange = (e) => {
        // If CGPA is not applicable, don't allow changes
        if (!isCgpaApplicable) return;

        const newValue = parseFloat(e.target.value);
        setMinimumCGPA(newValue);
        setCgpaInputValue(newValue.toFixed(2));
        setCgpaError(false);

        // Update the slider's fill percentage
        updateSliderPercentage(newValue);
    };

    const handleJobDescriptionChange = (e) => {
        setJobDescription(e.target.value);
    };

    const handleRequirementsChange = (e) => {
        setRequirements(e.target.value);
    };

    // Helper function to update the slider fill percentage CSS variable
    const updateSliderPercentage = (value) => {
        // If CGPA is not applicable, set percentage to 0%
        if (!isCgpaApplicable) {
            const sliderElement = document.getElementById('cgpa');
            if (sliderElement) {
                sliderElement.style.setProperty('--slider-percentage', '0%');
            }
            return;
        }

        // Calculate percentage (value from 0-4 to 0-100%)
        const percentage = (value / 4) * 100;
        // Find the slider element and update its CSS variable
        const sliderElement = document.getElementById('cgpa');
        if (sliderElement) {
            sliderElement.style.setProperty('--slider-percentage', `${percentage}%`);
        }
    };

    // Initialize the slider percentage when component mounts
    useEffect(() => {
        if (isCgpaApplicable) {
            updateSliderPercentage(minimumCGPA);
        } else {
            // For N/A state, set to 0% for no color
            const sliderElement = document.getElementById('cgpa');
            if (sliderElement) {
                sliderElement.style.setProperty('--slider-percentage', '0%');
            }
        }
    }, [minimumCGPA, isCgpaApplicable]);

    // Add auto-resize function for the job description textarea
    const handleJobDescriptionInput = (e) => {
        const target = e.target.closest('.bias-highlighting-input');
        if (target) {
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
        }
    };

    // Add this new function for creating more jobs
    const handleCreateMoreJob = () => {
        // Reset the form and navigate back to job details
        setCurrentStep("jobDetails");
        setJobTitle("");
        setJobDescription("");
        setRequirements("");
        setDepartments([]);
        setMinimumCGPA(2.50);
        setCgpaInputValue("2.50");
        setIsCgpaApplicable(true); // Reset applicability
        setSkills([]);
        setJobData(null);
        fileDispatch({ type: 'RESET' });
        setApiStatus("idle");
        setSubmitProgress(0);
        setShowSuccessModal(false);
    };

    // Function to toggle CGPA applicability
    const toggleCgpaApplicability = () => {
        if (isCgpaApplicable) {
            // When switching to N/A
            setIsCgpaApplicable(false);
            setCgpaInputValue("N/A");
            // Store null internally to represent N/A
            setMinimumCGPA(null);
            // Set slider to 0% for no color
            setTimeout(() => {
                const sliderElement = document.getElementById('cgpa');
                if (sliderElement) {
                    sliderElement.style.setProperty('--slider-percentage', '0%');
                }
            }, 0);
        } else {
            // When switching back to applicable
            setIsCgpaApplicable(true);
            setMinimumCGPA(2.50);
            setCgpaInputValue("2.50");
            // Directly set the slider percentage without checking the state
            // This ensures the color is restored immediately
            setTimeout(() => {
                const sliderElement = document.getElementById('cgpa');
                if (sliderElement) {
                    const percentage = (2.50 / 4) * 100;
                    sliderElement.style.setProperty('--slider-percentage', `${percentage}%`);
                }
            }, 0);
        }
    };

    // Example usage for upload-more-cv
    const handleUploadMoreCV = async (jobId, files) => {
        const formData = new FormData();
        formData.append("job_id", jobId);
        files.forEach(file => formData.append("files", file));

        try {
            const response = await fetch(UPLOAD_MORE_CV_ENDPOINT, {
                method: "POST",
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();
            console.log("Upload more CV response:", data);
        } catch (error) {
            console.error("Error uploading more CVs:", error);
        }
    };

    useEffect(() => {
        // Ensure consistent highlighting after bias analysis
        if (Object.keys(biasResults).length > 0 || Object.values(biasedTerms).some(terms => terms.length > 0)) {
            console.log("Bias detected, updating highlights...");
        } else {
            console.log("No bias detected, clearing highlights...");
        }
    }, [biasResults, biasedTerms]);

    return (
        <div className="app-container">
            {getFullPageOverlay()}

            {apiStatus === "loading" && (
                <div className="api-loading-overlay">
                    <div className="api-loading-content">
                        {/* Keep the original loading animation from pageloading.css */}
                        <LoadingAnimation />
                        <p>Submitting job and uploading files...</p>
                        {/* Progress bar positioned below the animation */}
                        <div className="progress-bar-container">
                            <div
                                className="progress-bar"
                                style={{ width: `${submitProgress}%` }}
                            ></div>
                            <span className="progress-text">{Math.round(submitProgress)}%</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Render success and error modals */}
            {showSuccessModal && <SuccessModal />}
            {showErrorModal && <ErrorModal />}
            {showBiasModal && (
                <BiasDetectionModal
                    isOpen={showBiasModal}
                    onClose={() => setShowBiasModal(false)}
                    biasResults={biasResults}
                    biasedTerms={biasedTerms}
                />
            )}
            {/* Suggestion Modal */}
            <JobSuggestionModal
                isOpen={showSuggestionModal}
                onClose={handleCloseSuggestionModal}
                onSubmit={handleGenerateSuggestions}
                jobTitle={jobTitle}
                isLoading={isGeneratingSuggestions}
            />
            <AIConfirmationModal
                isOpen={showAIConfirmModal}
                onReview={handleAIReviewCVs}
                onContinue={handleAIContinueAnyways}
                flaggedFiles={flaggedAIData}
                isLoading={apiStatus === "loading"}
            />

            {currentStep === "jobDetails" ? (
                <div className="job-container">
                    <h3 className="job-title-header">Create New Job</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="jobTitle" className="form-label">Job Title <span className="required">*</span></label>
                            <div className="suggestion-container">
                                <BiasHighlightingInput
                                    id="jobTitle"
                                    value={jobTitle}
                                    onChange={(e) => setJobTitle(e.target.value)}
                                    placeholder="Enter job title"
                                    biasedTerms={biasedTerms.jobTitle || []}
                                    multiline={false}
                                    aria-required="true"
                                />
                                {showJobTitleSuggestions && (
                                    <ul className="suggestions-list">
                                        {jobTitleSuggestions.map((suggestion, index) => (
                                            <li
                                                key={index}
                                                onMouseDown={(e) => {
                                                    e.preventDefault(); // Prevent input blur before click
                                                    handleJobTitleSelect(suggestion);
                                                }}
                                            >
                                                {suggestion}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={handleOpenSuggestionModal}
                                className="suggest-button" // Add CSS for this button
                                disabled={isGeneratingSuggestions}
                                title="Generate Description & Requirements suggestions based on Job Title"
                            >
                                {isGeneratingSuggestions ? 'Generating...' : 'Suggest Job Details (AI)'}
                                <svg className="suggest-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0v-2.5h-2.5a.75.75 0 010-1.5h2.5v-2.5A.75.75 0 0110 3zM8.707 13.707a1 1 0 11-1.414-1.414L8.586 11H7a1 1 0 110-2h1.586l-1.293-1.293a1 1 0 111.414-1.414L11.414 10l-2.707 2.707zM10 18a8 8 0 100-16 8 8 0 000 16z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        {generatedSuggestions && (
                            <div className={`suggestion-display ${showGeneratedSuggestions ? 'expanded' : 'collapsed'}`}>
                                <button
                                    type="button"
                                    onClick={toggleSuggestionDisplay}
                                    className="suggestion-toggle-button"
                                >
                                    {showGeneratedSuggestions ? 'Hide' : 'Show'} AI Suggestions
                                    <svg className={`toggle-icon ${showGeneratedSuggestions ? 'up' : 'down'}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                </button>
                                <div className="suggestion-content">
                                    <div className="suggestion-section">
                                        <h4>Suggested Description:</h4>
                                        <pre className="suggestion-text">{generatedSuggestions.description}</pre>
                                        <button type="button" onClick={() => handleApplySuggestion('description')} className="apply-suggestion-button">Apply Description</button>
                                    </div>
                                    <div className="suggestion-section">
                                        <h4>Suggested Requirements:</h4>
                                        <pre className="suggestion-text">{generatedSuggestions.requirements}</pre>
                                        <button type="button" onClick={() => handleApplySuggestion('requirements')} className="apply-suggestion-button">Apply Requirements</button>
                                    </div>
                                    <button type="button" onClick={() => handleApplySuggestion('both')} className="apply-suggestion-button both">Apply Both</button>
                                </div>
                            </div>
                        )}

                        {/* --- Job Description --- */}
                        <div className="form-group">
                            <label htmlFor="jobDescription" className="form-label">Description</label>
                            <div className="bias-highlighting-input-container"> {/* Wrap BiasHighlightingInput */}
                                <BiasHighlightingInput
                                    id="jobDescription"
                                    value={jobDescription}
                                    onChange={handleJobDescriptionChange} // Use specific handler
                                    onInput={handleJobDescriptionInput} // Use specific handler for resize
                                    placeholder="Enter job description (or use AI Suggest)"
                                    biasedTerms={biasedTerms.jobDescription || []}
                                    multiline={true} // Multiline for description
                                />
                            </div>
                        </div>

                        {/* --- Requirements/Qualifications --- */}
                        <div className="form-group">
                            <label htmlFor="requirements" className="form-label">Requirements / Qualifications</label>
                            <div className="bias-highlighting-input-container"> {/* Wrap BiasHighlightingInput */}
                                <BiasHighlightingInput
                                    id="requirements" // Add id
                                    value={requirements}
                                    onChange={handleRequirementsChange} // Use specific handler
                                    onInput={handleRequirementsInput} // Use specific handler for resize
                                    placeholder="Enter job requirements and qualifications (or use AI Suggest)"
                                    biasedTerms={biasedTerms.requirements || []}
                                    multiline={true} // Multiline for requirements
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="department" className="form-label">Department</label>
                            <div className="suggestion-container">
                                <div className="input-group">
                                    <input
                                        type="text"
                                        id="department"
                                        className="form-input"
                                        value={departmentInput}
                                        onChange={(e) => setDepartmentInput(e.target.value)}
                                        onKeyPress={handleDepartmentKeyPress}
                                        placeholder="Enter a department"
                                    />
                                    <button
                                        type="button"
                                        className="add-button"
                                        onClick={handleAddDepartment}
                                        disabled={!departmentInput.trim()}
                                    >
                                        Add
                                    </button>
                                </div>
                                {showDepartmentSuggestions && (
                                    <ul className="suggestions-list">
                                        {departmentSuggestions.map((suggestion, index) => (
                                            <li
                                                key={index}
                                                onMouseDown={(e) => {
                                                    e.preventDefault(); // Prevent input blur before click
                                                    handleDepartmentSelect(suggestion);
                                                }}
                                            >
                                                {suggestion}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {departments.length > 0 && (
                                <div className="tags-container">
                                    {departments.map((department, index) => (
                                        <div key={index} className="tag">
                                            {department}
                                            <button
                                                type="button"
                                                className="tag-remove"
                                                onClick={() => removeDepartment(department)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {departments.length > 0 && (biasedTerms.departments || []).length > 0 && (
                                <div className="bias-feedback">
                                    <p>Potentially biased terms:</p>
                                    <ul>
                                        {biasedTerms.departments.map((term, index) => (
                                            <li key={index}>{term}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="cgpa" className="form-label">Minimum CGPA</label>
                            <div className="cgpa-container">
                                <input
                                    type="range"
                                    id="cgpa"
                                    min="0"
                                    max="4"
                                    step="0.01"
                                    value={isCgpaApplicable ? minimumCGPA : 0}
                                    onChange={handleCGPASliderChange}
                                    className={`cgpa-slider ${!isCgpaApplicable ? 'disabled' : ''}`}
                                    aria-valuemin="0"
                                    aria-valuemax="4"
                                    aria-valuenow={isCgpaApplicable ? minimumCGPA : 0}
                                    aria-labelledby="cgpa-value"
                                    disabled={!isCgpaApplicable}
                                />
                                <input
                                    id="cgpa-value"
                                    type="text"
                                    className={`cgpa-value ${cgpaError ? 'error' : ''} ${!isCgpaApplicable ? 'disabled' : ''}`}
                                    value={cgpaInputValue}
                                    onChange={handleCGPAInputChange}
                                    onBlur={handleCGPABlur}
                                    aria-label="CGPA value"
                                    aria-invalid={cgpaError}
                                    disabled={!isCgpaApplicable}
                                />
                                <button
                                    type="button"
                                    className={`na-button ${!isCgpaApplicable ? 'active' : ''}`}
                                    onClick={toggleCgpaApplicability}
                                >
                                    Not Applicable
                                </button>
                            </div>
                            {cgpaError && (
                                <p className="error-message" role="alert">
                                    Please enter a valid CGPA between 0 and 4
                                </p>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="skills" className="form-label">Required Skills <span className="required">*</span></label>
                            <div className="suggestion-container">
                                <div className="input-group">
                                    <input
                                        type="text"
                                        id="skills"
                                        className="form-input"
                                        value={skillInput}
                                        onChange={(e) => setSkillInput(e.target.value)}
                                        onKeyPress={handleSkillKeyPress}
                                        placeholder="Enter a skill"
                                    />
                                    <button
                                        type="button"
                                        className="add-button"
                                        onClick={handleAddSkill}
                                        disabled={!skillInput.trim()}
                                    >
                                        Add
                                    </button>
                                </div>
                                {showSkillSuggestions && (
                                    <ul className="suggestions-list">
                                        {skillSuggestions.map((suggestion, index) => (
                                            <li
                                                key={index}
                                                onClick={() => handleSkillSelect(suggestion)}
                                            >
                                                {suggestion}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            {skills.length > 0 && (
                                <div className="tags-container"> {/* This parent div helps with overall layout of tags */}
                                    {skills.map((skill, index) => (
                                        // Each skill tag will be wrapped by a div with class "tag"
                                        // This "tag" class in UploadCV.css will provide the pinkish background and red text.
                                        <div key={`uploadcv-skill-${index}-${skill}`} className="tag"> 
                                            <SkillTagWithLogo 
                                                skillName={skill}
                                                unstyled={true} // Crucial: tells SkillTagWithLogo not to apply its internal default (purple) styles
                                            >
                                                {/* The remove button inherits its color from the parent .tag's text color */}
                                                <button
                                                    type="button"
                                                    className="tag-remove" // This class is styled in UploadCV.css
                                                    onClick={() => removeSkill(skill)}
                                                    aria-label={`Remove skill ${skill}`}
                                                >
                                                    ×
                                                </button>
                                            </SkillTagWithLogo>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {skills.length > 0 && (biasedTerms.requiredSkills || []).length > 0 && (
                                <div className="bias-feedback">
                                    <p>Potentially biased terms in Required Skills:</p>
                                    <ul>
                                        {(biasedTerms.requiredSkills || []).map((term, index) => (
                                            <li key={index}>{term}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        <div className="form-actions">
                            <button
                                type="submit"
                                className="submit-button"
                                disabled={isCheckingBias}
                            >
                                {isCheckingBias ? 'Checking for Bias...' : 'Next'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : (
                <>
                    <div className="step-header">
                        <div className="step-nav">
                            <button onClick={handleBackToJobDetails} className="back-button">
                                <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
                                </svg>
                                Back to Job Details
                            </button>
                        </div>
                        <h3 className="job-title-header">Upload Candidate CVs for {jobData?.jobTitle}</h3>
                    </div>

                    <div className="upload-container" ref={uploadContainerRef}>
                        <div className="upload-card">
                            <div className="upload-dropzone-container">
                                <div
                                    className={`upload-dropzone ${(fileState.isLoading || fileState.processingFiles) ? 'disabled-dropzone' : ''}`}
                                    onDragOver={handleDragOver}
                                    onDrop={handleDrop}
                                    role="button"
                                    tabIndex={fileState.isLoading || fileState.processingFiles ? -1 : 0}
                                    aria-label="Upload files by dropping them here or press to select files"
                                    aria-disabled={fileState.isLoading || fileState.processingFiles}
                                    onKeyDown={handleFileInputKeyDown}
                                >
                                    <div className="upload-icon-container">
                                        <svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                                        </svg>
                                    </div>
                                    <p className="upload-text">
                                        {(fileState.isLoading || fileState.processingFiles)
                                            ? "Please wait for the current upload to complete"
                                            : "Drag and Drop files to upload"}
                                    </p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".pdf,.doc,.docx"
                                        multiple
                                        onChange={handleFileChange}
                                        className="hidden-input"
                                        disabled={fileState.isLoading || fileState.processingFiles}
                                    />
                                    <button
                                        className={`browse-button ${(fileState.isLoading || fileState.processingFiles) ? 'disabled-button' : ''}`}
                                        onClick={handleChooseFile}
                                        disabled={fileState.isLoading || fileState.processingFiles}
                                    >
                                        {(fileState.isLoading || fileState.processingFiles)
                                            ? "Upload in Progress..."
                                            : "Browse Files"}
                                    </button>
                                    <p className="upload-subtext">Supports PDF, DOC, DOCX</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="files-container">
                        <h3 className="files-title" id="uploaded-files-heading">Uploaded Files</h3>
                        {fileState.selectedFiles.length === 0 ? (
                            <div className="no-files">
                                <p className="no-files-text">No files uploaded yet</p>
                            </div>
                        ) : (
                            <div
                                className="files-list"
                                role="list"
                                aria-labelledby="uploaded-files-heading"
                            >
                                {fileState.selectedFiles.map((file, index) => (
                                    <div
                                        key={index}
                                        className={`file-item ${aiFlaggedFiles.includes(file.name) ? 'ai-flagged-file' : ''}`}
                                        role="listitem"
                                    >
                                        <div className="file-content">
                                            {getFileIcon(file.name)}
                                            <div className="file-details">
                                                <div className="file-header">
                                                    <p className="file-name" title={file.name}>{file.name.length > 100 ? file.name.substring(0, 100) + '...' : file.name}</p>
                                                    <button
                                                        onClick={() => removeFile(index)}
                                                        className="delete-button"
                                                        aria-label={`Remove file ${file.name}`}
                                                        disabled={fileState.isLoading || fileState.processingFiles}
                                                    >
                                                        <svg className="delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                                        </svg>
                                                    </button>
                                                </div>
                                                {fileState.isLoading && fileState.uploadProgress[file.name] !== undefined && fileState.uploadProgress[file.name] < 100 ? (
                                                    <div className="progress-bar-container">
                                                        <div className="progress-bar" style={{ width: `${fileState.uploadProgress[file.name]}%` }}></div>
                                                        <span className="progress-text">{fileState.uploadProgress[file.name]}%</span>
                                                    </div>
                                                ) : fileState.processingFiles && fileState.uploadProgress[file.name] === undefined && fileState.uploadQueue && fileState.uploadQueue.some(queueFile => queueFile.name === file.name) ? (
                                                    <div className="waiting-container">
                                                        <p className="waiting-text">Waiting to upload...</p>
                                                    </div>
                                                ) : (
                                                    <p className="file-size">{(file.size / 1024).toFixed(1)} KB</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="final-submit-container">
                            <button
                                onClick={() => handleFinalSubmit(false)} // MODIFIED HERE
                                className="submit-button final-submit"
                                disabled={fileState.isLoading || fileState.processingFiles || apiStatus === "loading"}
                            >
                                {fileState.isLoading || fileState.processingFiles ? 'Uploading Files...' :
                                    apiStatus === "loading" ? 'Submitting...' : 'Submit Job Details and CV'}
                            </button>
                        </div>
                    </div>
                </>
            )}
            <JobSuggestionModal
                isOpen={showSuggestionModal}
                onClose={handleCloseSuggestionModal}
                onSubmit={handleGenerateSuggestions}
                jobTitle={jobTitle}
                isLoading={isGeneratingSuggestions}
            />
        </div>
    );
};

export default UploadCV;
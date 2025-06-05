import React, { useState, useRef, useEffect, useCallback, useReducer } from "react";
import "../components/pages/UploadCV.css"; // Ensure this path is correct
import "./UploadMoreCVModal.css"; // Ensure this path is correct
import "../components/pageloading.css"; // Ensure this path is correct
import DuplicateFilesModal from "./DuplicateFilesModal"; // Ensure this path is correct
import AIConfirmationModal from '../components/AIConfirmationModal.js';

// File upload reducer (remains largely the same, ensure RESET clears relevant states)
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
        case 'FOUND_DUPLICATES':
            return {
                ...state,
                duplicateFiles: action.payload.duplicates,
                nonDuplicateFiles: action.payload.nonDuplicateFiles,
                showDuplicatesModal: true,
                processingFiles: false,
                isLoading: false,
                isModalHidden: false
            };
        case 'CLOSE_DUPLICATES_MODAL':
            return { ...state, showDuplicatesModal: false, isModalHidden: false };
        case 'RESET':
            return {
                selectedFiles: [],
                isLoading: false,
                uploadProgress: {},
                uploadQueue: [],
                processingFiles: false,
                duplicateFiles: [],
                showDuplicatesModal: false,
                isModalHidden: false
                // fileFlags will be reset outside the reducer
            };
        default:
            return state;
    }
};

const LoadingAnimation = () => (
    <div className="loading-animation">
        <div className="seesaw-container"><div className="bar"></div><div className="ball"></div></div>
    </div>
);

const UploadMoreCVModal = ({ isOpen, onClose, jobId, jobTitle, onUploadComplete }) => {
    const [fileState, fileDispatch] = useReducer(fileUploadReducer, {
        selectedFiles: [],
        isLoading: false,
        uploadProgress: {},
        uploadQueue: [],
        processingFiles: false,
        duplicateFiles: [],
        showDuplicatesModal: false,
        isModalHidden: false
    });

    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef(null);
    const uploadContainerRef = useRef(null);
    const progressAnimationRef = useRef(null);

    const [apiStatus, setApiStatus] = useState("idle");
    const [submitProgress, setSubmitProgress] = useState(0);

    const [showErrorModal, setShowErrorModal] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [userConsentedToAIUpload, setUserConsentedToAIUpload] = useState(false);
    const [userConsentedToIrrelevantUpload, setUserConsentedToIrrelevantUpload] = useState(false);


    const [showAIConfirmModal, setShowAIConfirmModal] = useState(false);
    const [flaggedAIData, setFlaggedAIData] = useState([]);
    const [fileFlags, setFileFlags] = useState({});

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setUserConsentedToAIUpload(false);
            setUserConsentedToIrrelevantUpload(false);
        } else {
            document.body.style.overflow = 'visible';
        }
        return () => {
            document.body.style.overflow = 'visible';
        };
    }, [isOpen]);

    useEffect(() => {
        return () => {
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }
        };
    }, []);

    const processFiles = useCallback((files) => {
        if (fileState.isLoading || fileState.processingFiles || apiStatus !== "idle") {
            alert("Please wait for the current operation to complete before adding new files.");
            return;
        }
        let updatedFiles = [...fileState.selectedFiles];
        let newFiles = [];
        const newFileFlags = { ...fileFlags };

        for (const fileToProcess of files) {
            const extension = fileToProcess.name.split('.').pop().toLowerCase();
            const validExtensions = ['pdf', 'doc', 'docx'];
            if (!validExtensions.includes(extension)) {
                alert(`${fileToProcess.name} is not a supported file type. Please upload PDF, DOC, or DOCX files only.`);
                continue;
            }
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
    }, [fileState.selectedFiles, fileState.isLoading, fileState.processingFiles, fileState.uploadQueue, apiStatus, fileFlags]);


    useEffect(() => {
        if (fileState.uploadQueue.length === 0) {
            if (fileState.processingFiles) fileDispatch({ type: 'QUEUE_COMPLETE' });
            return;
        }
        const processAllFiles = async () => {
            for (const fileToProcess of fileState.uploadQueue) {
                fileDispatch({ type: 'FILE_PROGRESS', payload: { fileName: fileToProcess.name, progress: 100 } });
            }
            fileState.uploadQueue.forEach(() => fileDispatch({ type: 'FILE_COMPLETE' }));
        };
        processAllFiles();
    }, [fileState.uploadQueue, fileState.processingFiles]);

    useEffect(() => {
        const uploadContainer = uploadContainerRef.current;
        if (uploadContainer) {
            const handleLocalDragOver = (event) => { event.preventDefault(); uploadContainer.classList.add('dragover'); };
            const handleLocalDragLeave = () => uploadContainer.classList.remove('dragover');
            const handleLocalDrop = () => uploadContainer.classList.remove('dragover');
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
        if (!isOpen) return;
        const handleDocumentDragOver = (event) => { event.preventDefault(); if (!isDragging && !fileState.isLoading && !fileState.processingFiles) setIsDragging(true); };
        const handleDocumentDragLeave = (event) => { event.preventDefault(); if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) setIsDragging(false); };
        const handleDocumentDrop = (event) => {
            event.preventDefault();
            setIsDragging(false);
            if (fileState.isLoading || fileState.processingFiles) { alert("Please wait for the current operation to complete."); return; }
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0) processFiles(files);
        };
        document.addEventListener('dragover', handleDocumentDragOver);
        document.addEventListener('dragleave', handleDocumentDragLeave);
        document.addEventListener('drop', handleDocumentDrop);
        return () => {
            document.removeEventListener('dragover', handleDocumentDragOver);
            document.removeEventListener('dragleave', handleDocumentDragLeave);
            document.removeEventListener('drop', handleDocumentDrop);
        };
    }, [isDragging, processFiles, fileState.isLoading, fileState.processingFiles, isOpen]);

    const handleFileChange = (event) => { const files = Array.from(event.target.files); if (files.length > 0) { processFiles(files); event.target.value = ''; } };
    const handleDragOver = (event) => { event.preventDefault(); if (!fileState.isLoading && !fileState.processingFiles) event.dataTransfer.dropEffect = 'copy'; else event.dataTransfer.dropEffect = 'none'; };
    const handleDrop = (event) => { event.preventDefault(); setIsDragging(false); if (fileState.isLoading || fileState.processingFiles) { alert("Please wait for current operation."); return; } const files = Array.from(event.dataTransfer.files); if (files.length > 0) processFiles(files); };
    const handleFileInputKeyDown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current.click(); } };

    const removeFile = (index) => {
        const fileToRemove = fileState.selectedFiles[index];
        if (fileToRemove) {
            setFileFlags(prevFlags => {
                const newFlags = { ...prevFlags };
                delete newFlags[fileToRemove.name];
                return newFlags;
            });
        }
        fileDispatch({ type: 'REMOVE_FILE', payload: { index } });
    };

    const handleChooseFile = () => fileInputRef.current.click();
    const getFileIcon = (fileName) => { const ext = fileName.split('.').pop().toLowerCase(); if (ext === 'pdf') return <div className="file-icon pdf-icon">PDF</div>; if (['doc', 'docx'].includes(ext)) return <div className="file-icon doc-icon">DOC</div>; return <div className="file-icon default-icon">FILE</div>; };
    const getFullPageOverlay = () => { if (!isDragging) return null; return (<div className="fullpage-drop-overlay"><div className="drop-content"><div className="file-preview"><div className="file-icon-large pdf-icon-large">FILE</div>{fileState.selectedFiles.length > 0 && <div className="copy-badge">Copy</div>}</div><h2 className="drop-title">Drop files anywhere</h2><p className="drop-subtitle">Drop file(s) to upload it</p></div></div>); };

    const API_ENDPOINT = "http://localhost:8000/api/jobs/upload-more-cv";

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
                    setSubmitProgress(92 + (7 * (processedCount / totalCandidates)));
                } catch (error) { failedCount++; console.error(`Error generating profile for candidate ${candidateId}:`, error); }
            }));
            if (i + batchSize < candidateIds.length) await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log(`Profile generation complete. Success: ${processedCount}, Failed: ${failedCount}`);
        return { processedCount, failedCount };
    };

    // MODIFIED: executeUpload now accepts force flags directly.
    const executeUpload = async (filesForUpload, options = {}) => {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const {
            isOverwriting = false,
            selectedFilenamesForAction = null,
            forceAi = false,
            forceIrrelevant = false
        } = options;

        if (!filesForUpload || filesForUpload.length === 0) {
            setErrorMessage("Please select files to upload.");
            setShowErrorModal(true);
            return;
        }
        setShowAIConfirmModal(false);

        try {
            if (progressAnimationRef.current) cancelAnimationFrame(progressAnimationRef.current);
            setApiStatus(isOverwriting ? "overwriting" : "uploading");
            setSubmitProgress(0);
            await new Promise(resolve => setTimeout(resolve, 400));

            const formData = new FormData();
            formData.append("job_id", jobId);
            formData.append("user_time_zone", userTimeZone);
            filesForUpload.forEach(file => formData.append("files", file));

            // MODIFIED: Use the passed parameters to set force flags.
            if (forceAi) {
                formData.append("force_upload_ai_flagged", "true");
            }
            if (forceIrrelevant) {
                formData.append("force_upload_irrelevant", "true");
            }

            formData.append("override_duplicates", String(isOverwriting));
            if (isOverwriting && selectedFilenamesForAction && selectedFilenamesForAction.length > 0) {
                formData.append("selected_filenames", JSON.stringify(selectedFilenamesForAction));
            }

            setSubmitProgress(15);
            let lastUpdateTime = Date.now();
            const simulateProgress = () => {
                if (apiStatus !== "uploading" && apiStatus !== "overwriting") return;
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
                const errorData = await response.json().catch(() => ({ detail: "Unknown error from server." }));
                if (response.status === 422 && errorData.error_type === "FLAGGED_CONTENT") {
                    // MODIFIED: Check if consent is still needed. This logic is now more robust because the re-upload will have the force flags.
                    const filesNeedAIConsent = errorData.flagged_files.some(f => f.is_ai_generated);
                    const filesNeedIrrelevantConsent = errorData.flagged_files.some(f => f.is_irrelevant);

                    if (filesNeedAIConsent || filesNeedIrrelevantConsent) {
                        setFlaggedAIData(errorData.flagged_files || []);
                        setShowAIConfirmModal(true);
                        setApiStatus("idle"); setSubmitProgress(0);
                        return;
                    }
                }
                if (response.status === 409 && errorData.duplicates && errorData.duplicates.length > 0) {
                    const duplicateFileNames = errorData.duplicates.map(d => d.fileName);
                    const nonDuplicateOriginalFiles = fileState.selectedFiles.filter(file => !duplicateFileNames.includes(file.name));
                    fileDispatch({ type: 'FOUND_DUPLICATES', payload: { duplicates: errorData.duplicates, nonDuplicateFiles: nonDuplicateOriginalFiles } });
                    setApiStatus("idle"); setSubmitProgress(0);
                    return;
                }
                throw { name: "APIError", status: response.status, data: errorData, message: errorData.message || JSON.stringify(errorData.detail) || `HTTP error ${response.status}` };
            }

            const responseData = await response.json();
            if (responseData.candidateIds && responseData.candidateIds.length > 0) {
                setSubmitProgress(92);
                await generateAndCheckDetailedProfiles(responseData.candidateIds);
            }
            setSubmitProgress(100);
            const count = responseData.applicationCount || responseData.newApplicationCount || filesForUpload.length;

            if (onUploadComplete) onUploadComplete(count);

            setFileFlags({});
            fileDispatch({ type: 'RESET' });
            setUserConsentedToAIUpload(false);
            setUserConsentedToIrrelevantUpload(false);
            setApiStatus("idle");
            setSubmitProgress(0);
            onClose();

        } catch (error) {
            if (progressAnimationRef.current) {
                cancelAnimationFrame(progressAnimationRef.current);
                progressAnimationRef.current = null;
            }
            console.error("Error during CV upload process:", error);

            let displayErrorMessage = "An error occurred. Please try again.";

            if (
                error.name === "APIError" &&
                error.status === 422 &&
                error.data &&
                error.data.error_type === "FLAGGED_CONTENT" &&
                error.data.flagged_files &&
                error.data.flagged_files.length > 0
            ) {
                const filesNeedAIConsent = error.data.flagged_files.some(f => f.is_ai_generated);
                const filesNeedIrrelevantConsent = error.data.flagged_files.some(f => f.is_irrelevant);

                if (filesNeedAIConsent || filesNeedIrrelevantConsent) {
                    setFlaggedAIData(error.data.flagged_files);
                    setShowAIConfirmModal(true);
                    setApiStatus("idle");
                    setSubmitProgress(0);
                    return;
                } else {
                    displayErrorMessage = error.data.message || "Flagged content error, but consent was given. Please check server logs.";
                }
            } else if (error.name === "APIError" &&
                error.status === 409 &&
                error.data &&
                error.data.error_type === "DUPLICATE_FILES_DETECTED") {

                const duplicateFileNames = error.data.duplicates.map(d => d.fileName);
                const nonDuplicateOriginalFiles = fileState.selectedFiles.filter(file =>
                    !duplicateFileNames.includes(file.name)
                );
                fileDispatch({
                    type: 'FOUND_DUPLICATES',
                    payload: {
                        duplicates: error.data.duplicates,
                        nonDuplicateFiles: nonDuplicateOriginalFiles
                    }
                });
                setApiStatus("idle");
                setSubmitProgress(0);
                return;
            }

            if (error.data && error.data.message) {
                displayErrorMessage = error.data.message;
            } else if (error.message && !error.message.toLowerCase().includes("http error")) {
                 displayErrorMessage = error.message;
            } else if (error.status) {
                displayErrorMessage = `HTTP error ${error.status}`;
            }

            setApiStatus("error");
            setErrorMessage(displayErrorMessage);
            setShowErrorModal(true);
        }
    };

    // MODIFIED: Initial upload call passes default false flags.
    const handleInitialUpload = () => {
        if (!fileState.selectedFiles || fileState.selectedFiles.length === 0) {
            setErrorMessage("Please upload at least one CV file"); setShowErrorModal(true); return;
        }
        setUserConsentedToAIUpload(false);
        setUserConsentedToIrrelevantUpload(false);
        executeUpload(fileState.selectedFiles, { forceAi: false, forceIrrelevant: false });
    };

    const handleAIReviewCVs = () => {
        const newFlags = {};
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

    // MODIFIED: This function now passes the force flags directly to executeUpload.
    const handleAIContinueAnyways = () => {
        setShowAIConfirmModal(false);
        let consentAI = false;
        let consentIrrelevant = false;
        flaggedAIData.forEach(file => {
            if (file.is_ai_generated) consentAI = true;
            if (file.is_irrelevant) consentIrrelevant = true;
        });

        // Set state for future actions (like duplicate handling)
        setUserConsentedToAIUpload(consentAI);
        setUserConsentedToIrrelevantUpload(consentIrrelevant);

        // Call executeUpload with the determined flags immediately
        executeUpload(fileState.selectedFiles, {
            forceAi: consentAI,
            forceIrrelevant: consentIrrelevant
        });
    };


    // MODIFIED: These handlers now pass the current consent state.
    const handleUploadNonDuplicatesFromModal = async () => {
        fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
        if (!fileState.nonDuplicateFiles || fileState.nonDuplicateFiles.length === 0) {
            if (onUploadComplete) onUploadComplete(0);
            fileDispatch({ type: 'RESET' });
            setFileFlags({});
            setUserConsentedToAIUpload(false);
            setUserConsentedToIrrelevantUpload(false);
            setApiStatus("idle");
            setSubmitProgress(0);
            onClose();
            return;
        }
        executeUpload(fileState.nonDuplicateFiles, {
            forceAi: userConsentedToAIUpload,
            forceIrrelevant: userConsentedToIrrelevantUpload
        });
    };

    const handleProceedWithDuplicatesFromModal = async (selectedDuplicateNamesToOverwrite = []) => {
        fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
        let filesToSubmitForOverwrite;
        let namesToSubmitForOverwrite;
        if (selectedDuplicateNamesToOverwrite && selectedDuplicateNamesToOverwrite.length > 0) {
            filesToSubmitForOverwrite = fileState.selectedFiles.filter(f => selectedDuplicateNamesToOverwrite.includes(f.name));
            namesToSubmitForOverwrite = selectedDuplicateNamesToOverwrite;
        } else {
            const originallyFlaggedDuplicateNames = fileState.duplicateFiles.map(d => d.fileName);
            filesToSubmitForOverwrite = fileState.selectedFiles.filter(f => originallyFlaggedDuplicateNames.includes(f.name));
            namesToSubmitForOverwrite = originallyFlaggedDuplicateNames;
        }
        if (!filesToSubmitForOverwrite || filesToSubmitForOverwrite.length === 0) {
            setErrorMessage("No files selected or identified for overwrite.");
            setShowErrorModal(true);
            setApiStatus("idle");
            return;
        }
        executeUpload(filesToSubmitForOverwrite, {
            isOverwriting: true,
            selectedFilenamesForAction: namesToSubmitForOverwrite,
            forceAi: userConsentedToAIUpload,
            forceIrrelevant: userConsentedToIrrelevantUpload
        });
    };


    const ErrorModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} >
            <div className="status-modal error-modal">
                <div className="status-icon error-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                </div>
                <h3 id="error-modal-title" className="status-title">Upload Failed!</h3>
                <p className="status-message">{errorMessage || "Please try again"}</p>
                <div className="status-buttons">
                    <button
                        className="status-button primary-button"
                        onClick={() => {
                            setShowErrorModal(false);
                            setApiStatus("idle");
                            setSubmitProgress(0);
                        }}
                        autoFocus
                    >
                        Try Again
                    </button>
                </div>
            </div>
        </div>
    );

    const handleFullClose = () => {
        fileDispatch({ type: 'RESET' });
        setFileFlags({});
        setUserConsentedToAIUpload(false);
        setUserConsentedToIrrelevantUpload(false);
        setApiStatus("idle");
        setSubmitProgress(0);
        onClose();
    };

    const handleCancelClick = () => { if (fileState.selectedFiles.length > 0 && apiStatus === 'idle') setShowConfirmModal(true); else handleFullClose(); };
    const handleConfirmDiscard = () => { setShowConfirmModal(false); handleFullClose(); };
    const handleCancelDiscard = () => setShowConfirmModal(false);

    const ConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>
                <h3 className="status-title">Discard Files?</h3><p className="status-description">Are you sure you want to discard the file upload?</p>
                <div className="status-buttons"><button className="status-button secondary-button" onClick={handleCancelDiscard}>No, Keep Files</button><button className="status-button primary-button" onClick={handleConfirmDiscard}>Yes, Discard Files</button></div>
            </div>
        </div>
    );

    const handleOverlayClick = (e) => { if (!fileState.isLoading && !fileState.processingFiles && apiStatus === 'idle') { if (fileState.selectedFiles.length > 0) setShowConfirmModal(true); else handleFullClose(); } };

    const handleCloseDuplicatesModal = (action) => {
        if (action === 'closeAll') {
            fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
            handleFullClose();
        } else {
            fileDispatch({ type: 'CLOSE_DUPLICATES_MODAL' });
        }
    };

    if (!isOpen) return null;

    return (
        <div className={`modal-overlay ${fileState.isModalHidden ? "modal-overlay-hidden" : ""}`} onClick={handleOverlayClick} role="dialog" aria-labelledby="modal-title" aria-modal="true" >
            <div className="modal-content" onClick={e => e.stopPropagation()} >
                {getFullPageOverlay()}
                {(apiStatus === "uploading" || apiStatus === "overwriting" || apiStatus === "reranking" || apiStatus === "completed") && (
                    <div className="api-loading-overlay">
                        <div className="api-loading-content">
                            <LoadingAnimation />
                            <p>{apiStatus === "overwriting" ? "Processing overwrite..." : apiStatus === "reranking" ? "Reranking..." : apiStatus === "completed" ? "Finalizing..." : "Uploading files..."}</p>
                            <div className="progress-bar-container"><div className="progress-bar" style={{ width: `${submitProgress}%` }}></div><span className="progress-text">{Math.round(submitProgress)}%</span></div>
                        </div>
                    </div>
                )}
                {showErrorModal && <ErrorModal />}
                {showConfirmModal && <ConfirmModal />}
                {showAIConfirmModal && (
                    <AIConfirmationModal
                        isOpen={showAIConfirmModal}
                        onReview={handleAIReviewCVs}
                        onContinue={handleAIContinueAnyways}
                        flaggedFiles={flaggedAIData}
                        isLoading={apiStatus === "uploading" || apiStatus === "overwriting"}
                        onClose={() => {
                            setShowAIConfirmModal(false);
                            handleAIReviewCVs();
                        }}
                    />
                )}
                {fileState.showDuplicatesModal && (
                    <DuplicateFilesModal
                        isOpen={fileState.showDuplicatesModal}
                        duplicates={fileState.duplicateFiles}
                        onClose={(action) => handleCloseDuplicatesModal(action)}
                        onProceed={handleProceedWithDuplicatesFromModal}
                        onUploadNonDuplicates={handleUploadNonDuplicatesFromModal}
                        nonDuplicateCount={fileState.nonDuplicateFiles ? fileState.nonDuplicateFiles.length : 0}
                    />
                )}

                {!fileState.showDuplicatesModal && !showAIConfirmModal && (
                    <>
                        <div className="modal-header">
                            <h2 id="modal-title" className="modal-title">Upload Candidate CVs for {jobTitle}</h2>
                            <button className="modal-close" onClick={handleCancelClick} aria-label="Close" disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="upload-container" ref={uploadContainerRef}>
                                <div className="upload-card">
                                    <div className="upload-dropzone-container">
                                        <div className={`upload-dropzone ${(fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle') ? 'disabled-dropzone' : ''}`} onDragOver={handleDragOver} onDrop={handleDrop} role="button" tabIndex={(fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle') ? -1 : 0} aria-label="Upload files" aria-disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'} onKeyDown={handleFileInputKeyDown}>
                                            <div className="upload-icon-container"><svg className="upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg></div>
                                            <p className="upload-text">{(fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle') ? "Processing..." : "Drag and Drop files to upload"}</p>
                                            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" multiple onChange={handleFileChange} className="hidden-input" disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'} />
                                            <button className={`browse-button ${(fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle') ? 'disabled-button' : ''}`} onClick={handleChooseFile} disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'}>{(fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle') ? "Processing..." : "Browse Files"}</button>
                                            <p className="upload-subtext">Supports PDF, DOC, DOCX</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="files-container">
                                <h3 className="files-title" id="uploaded-files-heading">Selected Files</h3>
                                {fileState.selectedFiles.length === 0 ? (<div className="no-files"><p className="no-files-text">No files selected yet</p></div>) : (
                                    <div className="files-list" role="list" aria-labelledby="uploaded-files-heading">
                                        {fileState.selectedFiles.map((file, index) => {
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
                                                                <p className="file-name" title={file.name}>
                                                                    {file.name.length > 60 ? file.name.substring(0, 60) + '...' : file.name}
                                                                </p>
                                                                <div className="badges-main-list">
                                                                    {isAI && (
                                                                        <span className="badge-main-list ai-badge-main-list">
                                                                            AI Detected {aiConfidence ? `(${(aiConfidence * 100).toFixed(0)}%)` : ''}
                                                                        </span>
                                                                    )}
                                                                    {isIrrelevant && (
                                                                        <span className="badge-main-list irrelevant-badge-main-list">
                                                                            {irrelevanceScore !== undefined && irrelevanceScore !== null
                                                                                ? `${irrelevanceScore.toFixed(0)}% Irrelevant`
                                                                                : "Irrelevant"}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <button onClick={() => removeFile(index)} className="delete-button" aria-label={`Remove file ${file.name}`} disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'}>
                                                                    <svg className="delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                                                </button>
                                                            </div>
                                                            {(fileState.isLoading && fileState.uploadProgress[file.name] !== undefined && fileState.uploadProgress[file.name] < 100) ? (<div className="progress-bar-container"><div className="progress-bar" style={{ width: `${fileState.uploadProgress[file.name]}%` }}></div><span className="progress-text">{fileState.uploadProgress[file.name]}%</span></div>) : (fileState.processingFiles && fileState.uploadProgress[file.name] === undefined && fileState.uploadQueue && fileState.uploadQueue.some(queueFile => queueFile.name === file.name)) ? (<div className="waiting-container"><p className="waiting-text">Waiting to upload...</p></div>) : (<p className="file-size">{(file.size / 1024).toFixed(1)} KB</p>)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="modal-button secondary-button" onClick={handleCancelClick} disabled={fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'}>Cancel</button>
                            <button className="modal-button primary-button" onClick={handleInitialUpload} disabled={fileState.selectedFiles.length === 0 || fileState.isLoading || fileState.processingFiles || apiStatus !== 'idle'}>Upload CV{fileState.selectedFiles.length !== 1 ? 's' : ''}</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default UploadMoreCVModal;
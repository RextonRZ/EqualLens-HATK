import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import '../pageloading.css';

// LoadingAnimation component
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

// Custom header for interview pages only
const InterviewHeader = () => {
    // Add Google Fonts import for a similar font
    useEffect(() => {
        // Add Google Fonts link
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400&display=swap';
        document.head.appendChild(link);

        return () => {
            // Clean up
            document.head.removeChild(link);
        };
    }, []);

    return (
        <div style={{
            background: 'linear-gradient(90deg, rgb(226, 83, 95) 0%, rgb(249, 100, 95) 100%)',
            height: '80px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'sticky',
            top: 0,
            zIndex: 1000,
            width: '100%',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '80px',
                maxWidth: '1500px',
                width: '100%'
            }}>
                <div style={{
                    color: '#fff',
                    fontSize: '2rem',
                    display: 'flex',
                    alignItems: 'center',
                }}>
                    <img
                      src="/equalLensLogoWhite.png"
                      alt="EqualLens Logo Light"
                      className="navbar-logo-image"
                    />
                    <span style={{
                        fontFamily: "'Nunito', 'Arial', sans-serif",
                        fontWeight: '300', // Lighter weight to match logo
                        letterSpacing: '1px', // More spacing between letters
                        marginTop:'5px',
                        marginLeft: '7px', // Add some space between logo and text
                        fontSize: '2.1rem', // Slightly smaller to balance with logo
                        opacity: '0.95' // Slightly less opaque to appear lighter
                    }}>
                        Interview
                    </span>
                </div>
            </div>
        </div>
    );
};

// Initial Reminder Popup component - NEW
const InitialReminderPopup = ({ onUnderstand }) => {
    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            padding: '20px'
        }}>
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '30px',
                maxWidth: '550px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
                textAlign: 'center'
            }}>
                <div style={{
                    width: '80px',
                    height: '80px',
                    backgroundColor: '#fff8e1',
                    borderRadius: '50%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    margin: '0 auto 20px' // Adjusted margin shorthand
                }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f57c00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h2 style={{ color: '#f57c00', marginBottom: '15px', fontSize: '24px' }}>
                    Important Instructions
                </h2>
                <div style={{
                    textAlign: 'left',
                    backgroundColor: '#fff8e1',
                    padding: '15px',
                    borderRadius: '8px',
                    marginBottom: '20px'
                }}>
                    <ul style={{ paddingLeft: '20px', color: '#333', lineHeight: '1.6' }}>
                        <li><strong>You will have 20 seconds to read each question</strong> before recording begins</li>
                        <li><strong>You have only ONE chance to record</strong> your answer for each question</li>
                        <li>Recording will automatically start after the reading time</li>
                        <li>You can stop recording early if you finish your answer</li>
                        <li>Once you stop recording, you cannot re-record your answer</li>
                    </ul>
                </div>
                <p style={{ color: '#555', fontSize: '16px', marginBottom: '25px' }}>
                    Please ensure you are in a quiet environment with good lighting and a working microphone before proceeding.
                </p>
                <button
                    onClick={onUnderstand}
                    style={{
                        backgroundColor: '#ef402d',
                        color: 'white',
                        border: 'none',
                        padding: '14px 30px',
                        borderRadius: '6px',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#d63020'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#ef402d'}
                >
                    I Understand
                </button>
            </div>
        </div>
    );
};

// Reading Popup component
const ReadingPopup = ({ question, timeRemaining, currentQuestionIndex }) => {
    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999, // Ensure this is high enough
            padding: '20px'
        }}>
            <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '30px',
                width: '90%',
                maxWidth: '700px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)' // Corrected property name
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }}>
                    <h2 style={{ color: '#333', margin: 0, fontSize: '20px' }}>
                        Question {currentQuestionIndex + 1}
                    </h2>
                    <div style={{
                        backgroundColor: '#f57c00',
                        color: 'white',
                        padding: '8px 16px',
                        borderRadius: '20px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                        Reading: {timeRemaining}s
                    </div>
                </div>

                <div style={{
                    backgroundColor: '#f8f9fa',
                    padding: '25px',
                    borderRadius: '8px',
                    marginBottom: '20px',
                    boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.05)'
                }}>
                    <p style={{
                        color: '#333',
                        fontSize: '22px', // Bigger font size for question
                        lineHeight: '1.6',
                        margin: 0,
                        fontWeight: '500'
                    }}>
                        {question}
                    </p>
                </div>

                <p style={{ color: '#555', fontSize: '16px', margin: '20px 0' }}>
                    Recording will automatically start when the timer reaches zero.
                    You will only have ONE chance to record your answer.
                </p>

                {timeRemaining <= 10 && (
                    <div style={{
                        backgroundColor: '#ffebee',
                        padding: '12px 15px',
                        borderRadius: '6px',
                        color: '#d32f2f',
                        fontWeight: '500',
                        fontSize: '15px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                            <line x1="12" y1="9" x2="12" y2="13"></line> // Corrected SVG syntax
                            <line x1="12" y1="17" x2="12.01" y2="17"></line>
                        </svg>
                        Prepare to answer! Recording will begin in {timeRemaining} seconds.
                    </div>
                )}
            </div>
        </div>
    );
};

function InterviewQuestions() {
    const { interviewId, linkCode } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    // --- State Variables ---
    const [loading, setLoading] = useState(true);
    const [questions, setQuestions] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [interviewComplete, setInterviewComplete] = useState(false);
    const [error, setError] = useState(null);
    const [sectionTitle, setSectionTitle] = useState('');

    // Popups and Reading Timer
    const [showInitialReminder, setShowInitialReminder] = useState(false); // Start hidden, logic decides later
    const [showReadingPopup, setShowReadingPopup] = useState(false);
    const [readingTimeRemaining, setReadingTimeRemaining] = useState(20);
    const [isReading, setIsReading] = useState(false); // Start not reading initially
    const readingTimerIntervalRef = useRef(null);

    // Recording Timer
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [timerActive, setTimerActive] = useState(false);
    const [maxTimeLimit, setMaxTimeLimit] = useState(0);
    const timerIntervalRef = useRef(null);

    // Recording state
    const [recording, setRecording] = useState(false);
    const [recorded, setRecorded] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [videoBlob, setVideoBlob] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [hasRecordedOnce, setHasRecordedOnce] = useState(false); // Track if recording started for the current question
    const [shouldAutoStart, setShouldAutoStart] = useState(false); // Flag to trigger recording start
    const [isInterviewActive, setIsInterviewActive] = useState(false);

    // Media recorder refs
    const mediaRecorderRef = useRef(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const chunksRef = useRef([]);

    // Flags for logic control
    const isResuming = useRef(location.state?.isResuming || false); // Check if resuming from state
    const lastCompletedQuestionId = useRef(location.state?.lastCompletedQuestionId || null);

    const [gcsUploading, setGcsUploading] = useState(false);
    const [gcsUploadProgress, setGcsUploadProgress] = useState(0);

    // Define getCurrentQuestion FIRST
    const getCurrentQuestion = useCallback(() => {
        const currentQ = questions[currentQuestionIndex];
        return currentQ || { question: 'Loading...', timeLimit: 0, questionId: null, sectionTitle: '' };
    }, [questions, currentQuestionIndex]);

    // Define completeInterview
    const completeInterview = useCallback(async () => {
         if (interviewComplete) {
              console.warn("Attempted to complete interview again.");
              return;
         }
         console.log("Completing interview API call.");
         setIsInterviewActive(false);
         setLoading(true);
         setError(null);
         try {
             const response = await fetch('http://localhost:8000/api/interviews/complete-interview', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ interviewId, linkCode })
             });
             if (!response.ok) {
                 const errorData = await response.json().catch(() => ({ detail: 'Failed to parse error response' }));
                 throw new Error(errorData.detail || 'Failed to mark interview as complete');
             }
             setInterviewComplete(true);
         } catch (err) { // Use different variable name to avoid conflict with state 'error'
             console.error("Error completing interview:", err);
             setError(`Failed to complete interview: ${err.message}`);
             // Keep interview inactive
         } finally {
             setLoading(false);
         }
     }, [interviewId, linkCode, interviewComplete]);

    const moveToNextQuestion = useCallback(() => {
        console.log("Moving to next question or completing.");
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        if (readingTimerIntervalRef.current) clearInterval(readingTimerIntervalRef.current);
        if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.src = "";
            videoRef.current.controls = false;
            videoRef.current.muted = true;
        }

        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
             if (!interviewComplete) {
                 // Instead of calling completeInterview here, let the useEffect handle it
                 // by incrementing the index past the end.
                 setCurrentQuestionIndex(prev => prev + 1);
             }
        }
    }, [currentQuestionIndex, questions.length, interviewComplete]);

    const stopRecording = useCallback(() => {
        console.log("Stop recording called. Recorder state:", mediaRecorderRef.current?.state);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            console.log("MediaRecorder.stop() called.");
        } else {
            console.warn("Stop recording called but recorder was not in 'recording' state.");
            setRecording(false); // Ensure state is correct
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        }
        setTimerActive(false);
    }, []);

     const uploadRecording = useCallback(async (blobToUpload, recordedQuestionId, recordedQuestionText) => {
         if (!recordedQuestionId) {
             console.error("uploadRecording: Received invalid question details.", { recordedQuestionId, recordedQuestionText });
             setError("Cannot submit response: Critical question information was missing during upload. Please try refreshing if the issue persists.");
             setUploading(false); // Ensure uploading state is reset
             // Do NOT move to next question automatically here, let user see error
             return; // Stop the function execution
         }

         // Check blob first
        if (!blobToUpload || blobToUpload.size === 0) {
            console.error("Upload attempt with no valid video blob.");
            setError("Failed to record video data. Cannot upload.");
            setUploading(false);
            return;
        }

        // Check the PASSED IN question details
        if (!recordedQuestionId) {
             console.error("Cannot upload: recordedQuestionId is invalid/missing.", { recordedQuestionId, recordedQuestionText });
             setError("Cannot submit response: Critical question information is missing. Please try refreshing.");
             setUploading(false); // Ensure uploading state is reset
             setGcsUploading(false);
             setUploadProgress(0);
             setGcsUploadProgress(0);
             return; // Stop the function execution
         }

        // Reset states for the new upload process
        setGcsUploading(false);
        setGcsUploadProgress(0);
        setUploading(true);
        setUploadProgress(0);
        setError(null);

        let signedUrl = '';
        let gcsUri = '';
        let storagePath = '';

        try {
            // --- Stage 1: Get Signed URL from Backend ---
            console.log("Requesting signed URL from backend...");
            const urlRequestBody = {
                interviewId,
                linkCode,
                questionId: recordedQuestionId,
                contentType: blobToUpload.type || 'video/webm', // Send blob type
            };

            const urlResponse = await fetch('http://localhost:8000/api/interviews/generate-upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(urlRequestBody)
            });

            if (!urlResponse.ok) {
                const errorData = await urlResponse.json().catch(() => ({ detail: 'Failed to parse URL generation error' }));
                throw new Error(`Failed to get upload URL: ${errorData.detail || urlResponse.statusText}`);
            }

            const urlData = await urlResponse.json();
            signedUrl = urlData.signedUrl;
            gcsUri = urlData.gcsUri; // Get the GCS URI backend will use
            storagePath = urlData.storagePath; // Or storagePath
            console.log("Received signed URL:", signedUrl);
            console.log("Received GCS URI:", gcsUri);

            if (!signedUrl || !gcsUri) {
                throw new Error("Backend did not provide a valid signed URL or GCS URI.");
            }

            // --- Stage 2: Upload Blob directly to GCS using Signed URL ---
            console.log(`Uploading blob (${(blobToUpload.size / 1024 / 1024).toFixed(2)} MB) to GCS...`);
            setGcsUploading(true); // Indicate GCS upload is starting

            // Use fetch to PUT the blob
            // Note: fetch PUT doesn't easily provide progress. Use XMLHttpRequest for progress.
            const gcsUploadResponse = await fetch(signedUrl, {
                method: 'PUT',
                headers: {
                    // Crucially, match the contentType used to generate the signed URL
                    'Content-Type': blobToUpload.type || 'video/webm',
                },
                body: blobToUpload // Send the blob directly
            });

            setGcsUploading(false); // GCS upload finished

            if (!gcsUploadResponse.ok) {
                // Try to get error details from GCS response (might be XML)
                const errorText = await gcsUploadResponse.text();
                console.error("GCS Upload Error Status:", gcsUploadResponse.status);
                console.error("GCS Upload Error Response:", errorText);
                throw new Error(`Direct upload to cloud storage failed (Status: ${gcsUploadResponse.status}).`);
            }

            console.log("Blob successfully uploaded to GCS.");
            setGcsUploadProgress(100); // Mark GCS upload as complete

            // --- Stage 3: Submit Metadata (including GCS URI) to Backend ---
            console.log("Submitting response metadata to backend...");
            setUploadProgress(50); // Indicate metadata submission starting

            const metadataPayload = {
                interviewId,
                linkCode,
                questionId: recordedQuestionId,    // Use passed-in ID
                question: recordedQuestionText, // Use passed-in Text
                gcsUri: gcsUri // Send the GCS URI instead of base64
            };

            const submitResponse = await fetch('http://localhost:8000/api/interviews/submit-response', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metadataPayload)
            });

            if (!submitResponse.ok) {
                // Use the improved error handling from previous step
                let errorMessage = `Metadata submission failed: ${submitResponse.status}`;
                try {
                    const errorData = await submitResponse.json();
                    console.error("Backend Metadata Submit Error Data:", errorData);
                    errorMessage = errorData.detail || errorData.message || errorData.error || `Server error: ${JSON.stringify(errorData)}`;
                } catch (parseError) {
                    try {
                        const errorText = await submitResponse.text();
                        console.error("Backend Metadata Submit Error Text:", errorText);
                        errorMessage = errorText || `Metadata submission failed (Status ${submitResponse.status}, unreadable error).`;
                    } catch (textError) {
                        errorMessage = `Metadata submission failed (Status ${submitResponse.status}, unable to parse error).`;
                    }
                }
                throw new Error(errorMessage);
            }

            // --- Success ---
            setUploadProgress(100); // Metadata submission complete
            setUploading(false); // Entire process finished
            const result = await submitResponse.json();
            console.log("Response metadata submission successful:", result);

            setTimeout(() => {
                moveToNextQuestion();
            }, 1000);

        } catch (error) {
            console.error("Error during multi-stage upload:", error);
            setError(`Upload failed: ${error.message || 'An unknown error occurred'}`);
            setGcsUploading(false); // Ensure all uploading flags are false on error
            setUploading(false);
            setUploadProgress(0);
            setGcsUploadProgress(0);
        }

    }, [interviewId, linkCode, moveToNextQuestion, setError, setUploading, setUploadProgress]);

     // Setup media recorder (can be called on demand)
    const setupMediaRecorder = useCallback(async () => {
        // Ensure existing stream is stopped before getting a new one
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        const questionForThisRecording = getCurrentQuestion();
        const currentRecQuestionId = questionForThisRecording.questionId;
        const currentRecQuestionText = questionForThisRecording.question;

        console.log(
            `setupMediaRecorder: Attempting setup for index ${currentQuestionIndex}. Captured details:`,
            { id: currentRecQuestionId, text: currentRecQuestionText ? currentRecQuestionText.substring(0, 30) + '...' : 'N/A' }
        );

        // Defensive check: Ensure we have a valid question ID before proceeding with setup
        if (!currentRecQuestionId) {
            console.error("setupMediaRecorder: ABORTING setup. Question ID is invalid.", questionForThisRecording);
            setError("Failed to prepare recording: Question details were missing. Please wait a moment and try again, or refresh.");
            // Ensure recording state isn't accidentally set
            setRecording(false);
            setTimerActive(false);
            return false; // Indicate failure clearly
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            streamRef.current = stream;

            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.controls = false; // Ensure controls are off during recording preview
                videoRef.current.muted = true; // Mute preview to avoid feedback
            }

            // Check for supported MIME types
            const options = { mimeType: 'video/webm;codecs=vp9' };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn(`${options.mimeType} not supported, trying vp8`);
                options.mimeType = 'video/webm;codecs=vp8';
                if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                    console.warn(`${options.mimeType} also not supported, using default.`);
                    options.mimeType = 'video/webm'; // Fallback to basic webm
                }
            }

            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = []; // Clear previous chunks

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };
            mediaRecorder.onstop = () => {
                console.log(`onstop: Fired for question ID that *should* be ${currentRecQuestionId}. Chunks: ${chunksRef.current.length}`);
                const blob = new Blob(chunksRef.current, { type: options.mimeType });
                setVideoBlob(blob);

                // Stop the stream tracks *after* blob is created
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                }

                // Show preview of the recorded video
                const videoURL = URL.createObjectURL(blob);
                if (videoRef.current) {
                    videoRef.current.srcObject = null; // Remove stream source
                    videoRef.current.src = videoURL;
                    videoRef.current.muted = false; // Unmute for playback
                    videoRef.current.controls = true; // Show controls for playback
                }

                setRecorded(true);
                setRecording(false); // Update state: no longer recording

                const idToUpload = currentRecQuestionId;
                const textToUpload = currentRecQuestionText;

                console.log(`onstop: Preparing to upload with ID: ${idToUpload}`);

                // Auto submit after a short delay to allow state updates
                setTimeout(() => {
                    if (blob.size > 0) { // Only upload if there's data
                        uploadRecording(blob, idToUpload, textToUpload); // Pass the blob directly
                    } else {
                        console.warn("Blob size is 0, skipping upload.");
                        // Handle this case - maybe show an error or move on?
                        setError("Recording failed to capture video data.");
                        // Optionally move to next question even on failure, or allow retry?
                        // moveToNextQuestion(); // Decide on flow for zero-byte recording
                    }
                }, 500); // Short delay before uploading
            };

            mediaRecorder.onerror = (event) => {
                console.error("MediaRecorder error:", event.error);
                setError(`Recording error: ${event.error.name}`);
                stopRecording(); // Attempt to stop gracefully
            };

            console.log(`setupMediaRecorder: Setup successful for question ID ${currentRecQuestionId}`);
            return true; // Indicate success
        } catch (error) {
            console.error("Error accessing media devices:", error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setError('Camera/Microphone access denied. Please grant permission in your browser settings and refresh.');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                setError('No suitable camera/microphone found. Please ensure they are connected and enabled.');
            } else {
                setError(`Error accessing camera/microphone: ${error.message}`);
            }
            setLoading(false); // Stop loading if permission fails
            setShowInitialReminder(false); // Hide popups if setup fails
            setShowReadingPopup(false);
            return false; // Indicate failure
        }
    }, [getCurrentQuestion, stopRecording, uploadRecording, setError, setLoading, setShowInitialReminder, setShowReadingPopup, setRecorded, setRecording,currentQuestionIndex]);

    // Start Recording function
    const startRecording = useCallback(async () => {
        if (hasRecordedOnce) {
            console.warn("Attempted to record again for the same question.");
            return; // Prevent re-recording for the same question
        }

        setRecorded(false); // Ensure recorded state is false
        setVideoBlob(null); // Clear any previous blob
        setError(null);     // Clear previous errors
        setHasRecordedOnce(true); // Mark that recording has started for this attempt

        // Set timer to the max limit for this question
        setTimeRemaining(maxTimeLimit);

        // Setup media recorder and get stream
        const success = await setupMediaRecorder();
        if (!success) {
            setHasRecordedOnce(false); // Reset if setup failed
            return; // Stop if setup failed (e.g., permissions denied)
        }

        // Ensure recorder is ready before starting
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
            mediaRecorderRef.current.start();
            console.log("Recording started.");
            setRecording(true); // Set recording state
            setTimerActive(true); // Start the countdown timer
        } else {
            console.error("MediaRecorder not ready or already recording.");
            setError("Could not start recording. Please refresh and try again.");
            setHasRecordedOnce(false); // Reset flag if start fails
        }
    }, [hasRecordedOnce, maxTimeLimit, setupMediaRecorder, setError, setRecorded, setHasRecordedOnce, setTimeRemaining, setRecording, setTimerActive]);

    // Hide the main navbar when this component is mounted
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .navbar {
                display: none !important;
            }
            body {
                padding-top: 0 !important; /* Adjust body padding if navbar added space */
            }
        `;
        document.head.appendChild(style);

        // Clean up when component unmounts
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    useEffect(() => {
    const handleBeforeUnload = (e) => {
        if (isInterviewActive && !interviewComplete && (recording || uploading)) {
            console.log("Attempting to send abandon beacon..."); // Debug log

            const formData = new FormData();
            formData.append('interviewId', interviewId); // Send as form fields
            formData.append('linkCode', linkCode);

            // sendBeacon will automatically use an appropriate Content-Type for FormData
            const success = navigator.sendBeacon('http://localhost:8000/api/interviews/abandon-interview', formData);
            console.log("Beacon sent:", success); // Log if the browser queued it (doesn't guarantee server processing)

            const message = "You have an ongoing recording or upload. Leaving the page will abandon the interview. Are you sure?";
            e.returnValue = message;
            return message;
        }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
    };
}, [interviewId, linkCode, isInterviewActive, interviewComplete, recording, uploading]);

    // Block navigation attempts during recording/processing
    useEffect(() => {
        const handleBeforeUnload = (e) => {
            if (recording || uploading) { // Check if actively recording or uploading
                const message = "You have an ongoing recording or upload. Are you sure you want to leave? Your progress may be lost.";
                e.returnValue = message;
                return message;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [recording, uploading]); // Dependencies updated

    // Fetch questions and handle initial setup/resumption
    useEffect(() => {
        const fetchAndSetup = async () => {
            // Add this check: If already complete, don't fetch/validate again
            if (interviewComplete) {
                console.log("fetchAndSetup: Interview already marked complete in state, skipping fetch.");
                setLoading(false); // Ensure loading is off
                return;
            }

            setLoading(true);
            setError(null);

            try {
                // Validate first to ensure status is still okay (e.g., in_progress)
                const validateResponse = await fetch(`http://localhost:8000/api/interviews/validate/${interviewId}/${linkCode}`);
                const validateData = await validateResponse.json();

                if (!validateResponse.ok || !validateData.valid || validateData.currentStatus !== 'in_progress') {
                    // If status changed unexpectedly (e.g., completed/expired elsewhere) or link invalid
                     throw new Error(validateData.detail || "Interview access is no longer valid.");
                }
                // Mark interview as active now that we've confirmed status is in_progress
                setIsInterviewActive(true);

                // Fetch actual questions
                const questionsResponse = await fetch(`http://localhost:8000/api/interviews/questions/${interviewId}/${linkCode}`);
                if (!questionsResponse.ok) {
                    const errorData = await questionsResponse.json().catch(() => ({ detail: 'Failed to parse error response' }));
                    throw new Error(errorData.detail || `Failed to fetch questions: ${questionsResponse.status}`);
                }
                const questionsData = await questionsResponse.json();

                if (!Array.isArray(questionsData) || questionsData.length === 0) {
                    throw new Error('No questions found for this interview');
                }

                const validatedQuestions = questionsData.map(q => ({
                    questionId: q.questionId,
                    question: q.question || 'Question text missing',
                    timeLimit: Number.isFinite(q.timeLimit) && q.timeLimit > 0 ? q.timeLimit : 120,
                    sectionTitle: q.sectionTitle || 'General'
                }));
                setQuestions(validatedQuestions);

                // --- Handle Resumption ---
                let initialIndex = 0;
                if (isResuming.current && lastCompletedQuestionId.current) {
                    const lastCompletedIndex = validatedQuestions.findIndex(
                        q => q.questionId === lastCompletedQuestionId.current
                    );
                    if (lastCompletedIndex !== -1 && lastCompletedIndex < validatedQuestions.length - 1) {
                        initialIndex = lastCompletedIndex + 1; // Start at the next question
                        console.log(`Resuming interview at question index: ${initialIndex}`);
                    } else if (lastCompletedIndex === validatedQuestions.length - 1) {
                         // Resuming after the last question was answered but before completion clicked
                         console.log("Resuming after last question, marking as complete ready.");
                         setInterviewComplete(true); // Go straight to completion screen
                         setLoading(false);
                         return; // Stop further setup
                     } else {
                        console.warn("Last completed question ID not found, starting from beginning.");
                        // Fallback to starting from the beginning if ID mismatch
                    }
                }
                setCurrentQuestionIndex(initialIndex);

                // Set initial state for the first question to be shown
                if (validatedQuestions.length > initialIndex) {
                    const firstQuestionToShow = validatedQuestions[initialIndex];
                    setSectionTitle(firstQuestionToShow.sectionTitle);
                    setTimeRemaining(firstQuestionToShow.timeLimit);
                    setMaxTimeLimit(firstQuestionToShow.timeLimit);

                    // Decide whether to show initial reminder or reading popup
                    if (initialIndex === 0 && !isResuming.current) {
                         setShowInitialReminder(true); // Show reminder only for fresh start
                    } else {
                         setShowReadingPopup(true); // Show reading popup for resumed or later questions
                         setIsReading(true);
                         setReadingTimeRemaining(20);
                    }
                } else {
                    // Should not happen if questions array is not empty, but handle defensively
                    setInterviewComplete(true);
                }

            } catch (error) {
                console.error("Error during interview setup:", error);
                setError(error.message);
                 setIsInterviewActive(false); // Mark as inactive on error
            } finally {
                // Don't setLoading(false) if interviewComplete was set to true above
                 if (!interviewComplete) {
                     setLoading(false);
                 }
            }
        };

        fetchAndSetup();

        // Cleanup function
        return () => {
            if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            if (readingTimerIntervalRef.current) clearInterval(readingTimerIntervalRef.current);
        };
    }, [interviewId, linkCode, navigate, interviewComplete]);

    // Update section title and reset state when question index changes
    useEffect(() => {
        if (questions.length > 0 && currentQuestionIndex < questions.length) {
            const currentQuestion = questions[currentQuestionIndex];
            setSectionTitle(currentQuestion.sectionTitle);

            // Reset state for the new question
            setRecorded(false);
            setUploading(false);
            setVideoBlob(null);
            setUploadProgress(0);
            setHasRecordedOnce(false);
            setShouldAutoStart(false);
            setError(null); // Clear previous errors

            // Set timer for the new question
            const newTimeLimit = currentQuestion.timeLimit;
            setTimeRemaining(newTimeLimit);
            setMaxTimeLimit(newTimeLimit);

            setShowInitialReminder(false); // Ensure reminder is hidden
            setShowReadingPopup(true);
            setIsReading(true);
            setReadingTimeRemaining(20);

        } else if (questions.length > 0 && currentQuestionIndex >= questions.length) {
            // This case means we just finished the last question
            if (!interviewComplete) { // Prevent multiple calls
                 completeInterview();
            }
        }
    }, [currentQuestionIndex, questions, interviewComplete, completeInterview]);

    // Start reading timer when the reading popup is shown
    useEffect(() => {
        if (showReadingPopup && isReading && readingTimeRemaining > 0) {
            // Clear any existing interval first
            if (readingTimerIntervalRef.current) {
                clearInterval(readingTimerIntervalRef.current);
            }

            readingTimerIntervalRef.current = setInterval(() => {
                setReadingTimeRemaining(prev => {
                    if (prev <= 1) {
                        clearInterval(readingTimerIntervalRef.current);
                        setIsReading(false);
                        setShowReadingPopup(false); // Hide popup
                        setShouldAutoStart(true); // Trigger auto-start
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        // Cleanup function for this effect
        return () => {
            if (readingTimerIntervalRef.current) {
                clearInterval(readingTimerIntervalRef.current);
            }
        };
    }, [showReadingPopup, isReading, readingTimeRemaining]);

    // Auto-start recording after reading time ends
    useEffect(() => {
        let startTimer;
        if (shouldAutoStart && !isReading && !recording && !recorded) {
            // Using a short timeout allows UI updates (hiding popup) to render first
            startTimer = setTimeout(() => {
                startRecording();
                setShouldAutoStart(false); // Reset the flag
            }, 300); // Small delay (e.g., 300ms)
        }
        // Cleanup timeout if dependencies change before it fires
        return () => clearTimeout(startTimer);
    }, [shouldAutoStart, isReading, recording, recorded, hasRecordedOnce, startRecording]); // Dependencies for auto-start

    // Main Recording Timer effect
    useEffect(() => {
        if (timerActive && timeRemaining > 0) {
            // Clear any existing interval first
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }

            timerIntervalRef.current = setInterval(() => {
                setTimeRemaining(prev => {
                    if (prev <= 1) {
                        clearInterval(timerIntervalRef.current);
                        stopRecording(); // Automatically stop when time runs out
                        return 0;
                    }
                    return prev - 1;
                });
                // Note: totalElapsedTime state was here but seemed unused
            }, 1000);
        } else if (!timerActive) {
            // Clear interval if timer becomes inactive
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }
        }

        // Cleanup function for this effect
        return () => {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
            }
        };
    }, [timerActive, timeRemaining, stopRecording]); // Dependencies: run when active state or time changes

    // Handle clicking "I Understand" on the initial reminder
    const handleInitialReminderClose = () => {
        setShowInitialReminder(false); // Hide reminder
        setShowReadingPopup(true);     // Show reading popup for the first question
        setIsReading(true); // Start reading phase
        setReadingTimeRemaining(20); // Reset reading timer
    };

    // Format time helper MM:SS
    const formatTime = (seconds) => {
        const totalSeconds = Math.max(0, Math.floor(seconds)); // Ensure non-negative integer
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    };

    // Calculate progress percentage
    const getProgressPercentage = useCallback(() => {
        if (!questions || questions.length === 0) return '0%';
        const effectiveIndex = Math.min(currentQuestionIndex, questions.length);
        return `${Math.round((effectiveIndex / questions.length) * 100)}%`;
    }, [currentQuestionIndex, questions]);

    // Conditional Rendering Logic
    return (
        <>
            <InterviewHeader />

            {/* Initial Reminder (only shown at start, before reading first question) */}
            {showInitialReminder && !loading && !error && !interviewComplete && (
                <InitialReminderPopup onUnderstand={handleInitialReminderClose} />
            )}

            {/* Reading Popup (shown during reading time for each question) */}
            {showReadingPopup && !loading && !error && !interviewComplete && (
                <ReadingPopup
                    question={getCurrentQuestion().question}
                    timeRemaining={readingTimeRemaining}
                    currentQuestionIndex={currentQuestionIndex}
                />
            )}

            {/* Main Content Area (Loading, Error, Completion, or Interview Question) */}
            <div style={{ display: showInitialReminder || showReadingPopup ? 'none' : 'block' }}> {/* Hide main content if a popup is active */}
                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 80px)', padding: '20px' }}> {/* Adjusted height */}
                        <LoadingAnimation />
                        <h2 style={{ marginTop: '30px', color: '#333' }}>Loading interview...</h2> {/* Updated text */}
                    </div>
                ) : error ? (
                    // Error Display
                    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '30px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}> {/* */}
                        <div style={{ width: '80px', height: '80px', backgroundColor: '#ffdddd', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 20px' }}> {/* */}
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        </div>
                        <h2 style={{ color: '#e53935', marginBottom: '20px' }}>Error</h2>
                        <p style={{ color: '#555', fontSize: '18px', marginBottom: '30px', whiteSpace: 'pre-wrap' }}> {/* Allow line breaks in error message */}
                            {error}
                        </p>
                        {/* Only show refresh button if it's not a permission error */}
                        {!error.includes('permission') && !error.includes('denied') && !error.includes('found') && (
                            <button onClick={() => window.location.reload()} style={{ backgroundColor: '#ef402d', color: 'white', border: 'none', padding: '12px 30px', borderRadius: '4px', fontSize: '16px', cursor: 'pointer' }}> {/* */}
                                Try Again
                            </button>
                        )}
                    </div>
                ) : interviewComplete ? (
                    // Interview Completion Screen
                    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '40px', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 6px 18px rgba(0, 0, 0, 0.1)', textAlign: 'center' }}> {/* */}
                        <div style={{ width: '100px', height: '100px', backgroundColor: '#e8f5e9', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 25px' }}> {/* */}
                            <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </div>
                        <h1 style={{ color: '#333', fontSize: '32px', fontWeight: '600', marginBottom: '20px' }}>Interview Complete!</h1> {/* */}
                        <p style={{ color: '#555', fontSize: '18px', lineHeight: '1.6', marginBottom: '30px' }}>
                            Thank you for completing your interview. Your responses have been successfully submitted. {/* */}
                        </p>
                        <div style={{ padding: '25px', backgroundColor: '#f5f5f5', borderRadius: '8px', marginBottom: '30px', textAlign: 'left' }}> {/* */}
                            <h3 style={{ color: '#333', marginBottom: '15px', fontWeight: '500' }}>What happens next?</h3>
                            <p style={{ color: '#555', marginBottom: '10px' }}>1. Our hiring team will carefully review your interview responses.</p> {/* */}
                            <p style={{ color: '#555', marginBottom: '10px' }}>2. We aim to provide feedback or next steps within 5-7 business days.</p> {/* */}
                            <p style={{ color: '#555' }}>3. If you are selected to move forward, we will contact you to schedule the next stage.</p> {/* */}
                        </div>
                        <p style={{ color: '#777', fontSize: '14px' }}>
                            If you have any urgent questions, please contact our hiring team at support@equallens.com.
                        </p>
                    </div>
                ) : (
                    // Main Interview Question Display
                    <div style={{ maxWidth: '900px', margin: '40px auto', padding: '30px', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}> {/* */}
                        {/* Progress Bar */}
                        <div style={{ marginBottom: '30px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#666' }}> {/* */}
                                <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                                <span>{getProgressPercentage()} Complete</span>
                            </div>
                            <div style={{ height: '8px', backgroundColor: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}> {/* */}
                                <div style={{ height: '100%', width: getProgressPercentage(), backgroundColor: '#ef402d', borderRadius: '4px', transition: 'width 0.5s ease-in-out' }} /> {/* */}
                            </div>
                        </div>

                        {/* Section Title */}
                        {sectionTitle && (
                            <div style={{ backgroundColor: '#e3f2fd', padding: '12px 18px', borderRadius: '8px', marginBottom: '20px', borderLeft: '5px solid #2196f3' }}> {/* */}
                                <h2 style={{ color: '#0d47a1', margin: 0, fontSize: '18px', fontWeight: '500' }}> {/* */}
                                    Section: {sectionTitle}
                                </h2>
                            </div>
                        )}

                        {/* Question Text */}
                        <div style={{ backgroundColor: '#f9f9f9', padding: '25px', borderRadius: '8px', marginBottom: '25px', border: '1px solid #eee' }}> {/* */}
                            <h2 style={{ color: '#333', marginBottom: '15px', fontSize: '20px', fontWeight: '600' }}>
                                Question {currentQuestionIndex + 1}:
                            </h2>
                            <p style={{ color: '#333', fontSize: '18px', lineHeight: '1.6', margin: 0 }}>
                                {getCurrentQuestion().question}
                            </p>
                            {/* Time Limit Display */}
                            <div style={{ display: 'flex', alignItems: 'center', marginTop: '20px', padding: '8px 15px', backgroundColor: timerActive ? '#fff8e1' : '#f0f0f0', borderRadius: '20px', width: 'fit-content', border: `1px solid ${timerActive ? '#f57c00' : '#ddd'}` }}> {/* */}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={timerActive ? '#f57c00' : '#555'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"> {/* */}
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <polyline points="12 6 12 12 16 14"></polyline>
                                </svg>
                                <span style={{ marginLeft: '8px', color: timerActive ? '#f57c00' : '#555', fontWeight: timerActive ? 'bold' : 'normal', fontSize: '14px' }}> {/* */}
                                    Time limit: {formatTime(maxTimeLimit)} {/* Show max limit */} | Remaining: {formatTime(timeRemaining)} {/* Show remaining */}
                                </span>
                            </div>
                        </div>

                        {/* Video Area */}
                        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', marginBottom: '30px', backgroundColor: '#fdfdfd' }}> {/* */}
                            <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}> {/* */}
                                {/* Mirrored Video Container */}
                                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', transform: (recording && !recorded) ? 'scaleX(-1)' : 'none', transition: 'transform 0.3s' }}> {/* */}
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted={!recorded} // Mute during preview, unmute for playback
                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} //
                                    />
                                </div>

                                {/* Recording Indicator */}
                                {recording && (
                                    <div style={{ position: 'absolute', top: '15px', left: '15px', backgroundColor: 'rgba(0, 0, 0, 0.6)', color: 'white', padding: '6px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', zIndex: 10, fontSize: '14px' }}> {/* */}
                                        <span style={{ display: 'inline-block', width: '10px', height: '10px', backgroundColor: '#f44336', borderRadius: '50%', marginRight: '8px', animation: 'pulse 1.5s infinite ease-in-out' }} /> {/* */}
                                        <span>Recording... {formatTime(timeRemaining)}</span>
                                        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style> {/* Simplified pulse */}
                                    </div>
                                )}

                                {/* Uploading Overlay */}
                                {uploading && (
                                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0, 0, 0, 0.75)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', zIndex: 11 }}> {/* */}
                                        <p style={{ marginBottom: '15px', fontSize: '18px' }}>Uploading response...</p>
                                        <div style={{ width: '70%', maxWidth: '300px' }}> {/* */}
                                            <div style={{ width: '100%', height: '10px', backgroundColor: 'rgba(255, 255, 255, 0.3)', borderRadius: '5px', overflow: 'hidden' }}> {/* */}
                                                <div style={{ height: '100%', width: `${uploadProgress}%`, backgroundColor: '#4caf50', borderRadius: '5px', transition: 'width 0.2s linear' }} /> {/* */}
                                            </div>
                                            <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '14px' }}>{uploadProgress}%</div> {/* */}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Action Buttons Area */}
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginTop: '20px', minHeight: '50px' }}> {/* */}
                                {/* Show Stop Button only when actively recording */}
                                {!isReading && !showReadingPopup && recording && !recorded && !uploading && (
                                    <button
                                        onClick={stopRecording}
                                        disabled={uploading} // Disable if uploading starts somehow concurrently
                                        style={{ backgroundColor: '#e53935', color: 'white', border: 'none', padding: '12px 30px', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 0.2s' }} //
                                        onMouseOver={(e) => e.target.style.backgroundColor = '#c62828'}
                                        onMouseOut={(e) => e.target.style.backgroundColor = '#e53935'}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1"> {/* Adjusted icon */}
                                            <rect x="6" y="6" width="12" height="12" rx="1" ry="1"></rect>
                                        </svg>
                                        End Recording Early
                                    </button>
                                )}

                                {/* Display confirmation/uploading status after recording stops */}
                                {recorded && !uploading && (
                                    <div style={{ textAlign: 'center', color: '#4caf50', fontSize: '16px', fontWeight: '500' }}>
                                        <p>Response recorded. Submitting automatically...</p> {/* */}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Instructions Reminder */}
                        <div style={{ backgroundColor: '#f9f9f9', padding: '20px', borderRadius: '8px', border: '1px solid #eee' }}> {/* */}
                            <h3 style={{ color: '#333', marginBottom: '15px', fontSize: '18px', fontWeight: '500' }}>Key Reminders:</h3>
                            <ul style={{ color: '#555', paddingLeft: '25px', lineHeight: '1.7', margin: 0 }}>
                                <li>The timer shows your remaining response time.</li> {/* Simplified */}
                                <li>You have <strong>one chance</strong> to record your answer for this question.</li> {/* Emphasized */}
                                <li>Recording stops automatically when time runs out or if you end it early.</li> {/* Combined */}
                                <li>Your answer submits automatically after recording.</li> {/* */}
                            </ul>
                        </div>
                    </div>
                )}
            </div> {/* End Main Content Area Wrapper */}
        </>
    );
}

export default InterviewQuestions;
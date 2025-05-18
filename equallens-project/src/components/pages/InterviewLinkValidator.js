import React, { useState, useEffect, useCallback } from 'react';
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

const PreInterviewCheck = ({ onCheckComplete }) => {
    const [cameraOk, setCameraOk] = useState(null); // null, true, false
    const [micOk, setMicOk] = useState(null);
    const [connectionOk, setConnectionOk] = useState(null);
    const [testing, setTesting] = useState(true);
    const [error, setError] = useState(null);

    const runTests = useCallback(async () => {
        setTesting(true);
        setError(null);
        let allOk = true;
        let stream = null; // To store stream temporarily

        // --- Camera Check ---
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            setCameraOk(true);
            // Stop tracks immediately after check
            stream.getTracks().forEach(track => track.stop());
            console.log("Camera check OK");
        } catch (err) {
            console.error("Camera check failed:", err);
            setCameraOk(false);
            allOk = false;
            setError(prev => prev ? `${prev}\nCamera access denied or no camera found.` : 'Camera access denied or no camera found.');
        }

        // --- Microphone Check ---
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setMicOk(true);
            // Stop tracks immediately after check
            stream.getTracks().forEach(track => track.stop());
            console.log("Microphone check OK");
        } catch (err) {
            console.error("Microphone check failed:", err);
            setMicOk(false);
            allOk = false;
            setError(prev => prev ? `${prev}\nMicrophone access denied or no microphone found.` : 'Microphone access denied or no microphone found.');
        }

        // --- Connection Check ---
        try {
            // Use the health endpoint as a simple connectivity test
            const response = await fetch('http://localhost:8000/health', { method: 'GET', cache: 'no-cache' });
            if (response.ok) {
                setConnectionOk(true);
                console.log("Connection check OK");
            } else {
                throw new Error(`Server responded with status: ${response.status}`);
            }
        } catch (err) {
            console.error("Connection check failed:", err);
            setConnectionOk(false);
            allOk = false;
            setError(prev => prev ? `${prev}\nCould not connect to the interview server.` : 'Could not connect to the interview server.');
        }

        setTesting(false);
        if (allOk) {
            console.log("All checks passed.");
            onCheckComplete(true); // Signal success
        } else {
            console.log("Some checks failed.");
            onCheckComplete(false); // Signal failure
        }
    }, [onCheckComplete]);

    useEffect(() => {
        runTests();
    }, [runTests]); // Run tests on mount

    const renderStatusIcon = (status) => {
        if (status === true) return <span style={{ color: '#4caf50', fontWeight: 'bold' }}>✓ Passed</span>;
        if (status === false) return <span style={{ color: '#e53935', fontWeight: 'bold' }}>✗ Failed</span>;
        return <span style={{ color: '#f57c00' }}>Testing...</span>;
    };

    return (
        <div style={{ backgroundColor: '#f9f9f9', padding: '25px', borderRadius: '8px', marginBottom: '30px', border: '1px solid #eee' }}>
            <h3 style={{ color: '#333', marginBottom: '20px', textAlign: 'center' }}>Checking Your Setup...</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Camera Access:</span>
                    {renderStatusIcon(cameraOk)}
                </li>
                <li style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Microphone Access:</span>
                    {renderStatusIcon(micOk)}
                </li>
                <li style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Server Connection:</span>
                    {renderStatusIcon(connectionOk)}
                </li>
            </ul>
            {error && !testing && (
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#ffdddd', color: '#e53935', borderRadius: '4px', whiteSpace: 'pre-wrap' }}>
                    <strong>Issues Found:</strong><br />{error}<br />Please resolve the issues and try refreshing the page. Check browser permissions for camera/microphone.
                </div>
            )}
            {testing && (
                 <div style={{ textAlign: 'center', marginTop: '20px', color: '#666' }}>
                     Running checks...
                 </div>
            )}
        </div>
    );
};

function InterviewLinkValidator() {
    const { interviewId, linkCode } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [loading, setLoading] = useState(true);
    const [validationStatus, setValidationStatus] = useState('loading'); // 'loading', 'pending', 'in_progress', 'completed', 'abandoned', 'expired', 'error'
    const [error, setError] = useState(null);
    const [interviewData, setInterviewData] = useState(null);
    const [showChecks, setShowChecks] = useState(false);
    const [checksPassed, setChecksPassed] = useState(null); // null, true, false

    // Hide the main navbar when this component is mounted
    useEffect(() => {
        // Apply CSS to hide the navbar
        const style = document.createElement('style');
        style.innerHTML = `
            .navbar {
                display: none !important;
            }
            body {
                padding-top: 0 !important;
            }
        `;
        document.head.appendChild(style);

        // Clean up when component unmounts
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    useEffect(() => {
        // Flag to prevent state updates if component unmounts quickly after navigation
        let isMounted = true;

        const validateLink = async () => {
            // Don't reset state here, let the initial state handle loading
            // setLoading(true);
            // setValidationStatus('loading');
            // setError(null);
            // setShowChecks(false);
            // setChecksPassed(null);
            console.log("Running validation effect..."); // Debug log

            try {
                const response = await fetch(`http://localhost:8000/api/interviews/validate/${interviewId}/${linkCode}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || `Validation failed with status: ${response.status}`);
                }
                if (!data.valid) {
                    throw new Error("Interview link is marked as invalid by the server.");
                }

                // Check if component is still mounted before updating state
                if (!isMounted) return;

                console.log("Validation successful, data:", data); // Debug log
                setInterviewData(data);

                // --- Handle Different Statuses ---
                switch (data.currentStatus) {
                    case 'pending':
                        console.log("Status is pending, showing checks."); // Debug log
                        setValidationStatus('pending');
                        setShowChecks(true);
                        break;
                    case 'in_progress':
                        console.log("Status is in_progress, navigating to questions..."); // Debug log
                        // Set status briefly before navigating, though component might unmount
                        setValidationStatus('in_progress');
                        // Navigate immediately
                        navigate(`/interview/${interviewId}/${linkCode}/questions`, {
                            state: {
                                lastCompletedQuestionId: data.lastCompletedQuestionId,
                                isResuming: true
                            }
                        });
                        // No further state updates needed here as we are navigating away
                        return; // Exit early
                    case 'completed':
                        console.log("Status is completed."); // Debug log
                        setValidationStatus('completed');
                        setError("This interview has already been completed.");
                        break;
                    case 'abandoned':
                         console.log("Status is abandoned."); // Debug log
                        setValidationStatus('abandoned');
                        setError("This interview was previously abandoned and cannot be resumed.");
                        break;
                    case 'expired':
                         console.log("Status is expired."); // Debug log
                        setValidationStatus('expired');
                        setError("This interview link has expired.");
                        break;
                    default:
                        console.log(`Unexpected status: ${data.currentStatus}`); // Debug log
                        setValidationStatus('error');
                        setError(`Unexpected interview status: ${data.currentStatus}`);
                        break;
                }

            } catch (error) {
                console.error("Error validating interview link:", error);
                 if (!isMounted) return;
                setError(error.message || "An unknown error occurred during validation.");
                setValidationStatus('error');
            } finally {
                 if (!isMounted) return;
                // Stop loading ONLY if we are not navigating away immediately
                 if (validationStatus !== 'in_progress') { // Check the state *before* update
                     setLoading(false);
                 }
            }
        };

        validateLink();

        // Cleanup function to set isMounted to false
        return () => {
            isMounted = false;
            console.log("Validator effect cleanup."); // Debug log
        };
    // REMOVED validationStatus from the dependency array
    }, [interviewId, linkCode, navigate]); // Keep only stable dependencies

    const handleCheckComplete = (passed) => {
        setChecksPassed(passed);
        if (!passed) {
            // Error message is already set within PreInterviewCheck
            console.log("Pre-interview checks failed.");
        } else {
            console.log("Pre-interview checks passed.");
        }
    };

    const handleProceed = () => {
        if (checksPassed) {
            navigate(`/interview/${interviewId}/${linkCode}/id-verification`);
        } else {
            // This button should ideally be disabled if checks haven't passed
            alert("Please resolve the setup issues indicated above before proceeding.");
        }
    };

    if (loading || validationStatus === 'loading') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
                <LoadingAnimation />
                <h2 style={{ marginTop: '30px', color: '#333' }}>Validating your interview link...</h2>
            </div>
        );
    }

    // Handle final error/completed/abandoned states
    if (validationStatus === 'error' || validationStatus === 'completed' || validationStatus === 'abandoned' || validationStatus === 'expired') {
        const title = {
            error: 'Error Validating Link',
            completed: 'Interview Completed',
            abandoned: 'Interview Abandoned',
            expired: 'Link Expired'
        }[validationStatus] || 'Error';

        const iconColor = (validationStatus === 'completed') ? '#e8f5e9' : '#ffdddd';
        const strokeColor = (validationStatus === 'completed') ? '#4caf50' : '#e53935';
        const IconSvg = validationStatus === 'completed' ? (
             <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                 <polyline points="22 4 12 14.01 9 11.01"></polyline>
             </svg>
        ) : (
             <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <circle cx="12" cy="12" r="10"></circle>
                 <line x1="15" y1="9" x2="9" y2="15"></line>
                 <line x1="9" y1="9" x2="15" y2="15"></line>
             </svg>
        );

        return (
            <div> {/* Added wrapper for header */}
                <InterviewHeader />
                <div style={{ maxWidth: '600px', margin: '40px auto', padding: '30px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}>
                    <div style={{ width: '80px', height: '80px', backgroundColor: iconColor, borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 20px' }}>
                        {IconSvg}
                    </div>
                    <h2 style={{ color: strokeColor, marginBottom: '20px' }}>{title}</h2>
                    <p style={{ color: '#555', fontSize: '18px', marginBottom: '30px' }}>
                        {error || "This interview cannot be accessed."}
                    </p>
                    <p style={{ color: '#777', fontSize: '16px' }}>
                        Please contact the hiring team if you believe this is an error.
                    </p>
                </div>
            </div>
        );
    }

    // Render Welcome/Pre-check screen only if status is 'pending'
    if (validationStatus === 'pending' && interviewData) {
        return (
            <div>
                <InterviewHeader />
                <div style={{ maxWidth: '800px', margin: '40px auto', padding: '30px', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}>
                    {/* Welcome Message */}
                    <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                        <h1 style={{ color: '#ef402d', fontSize: '28px', marginBottom: '20px' }}>Welcome to Your Interview</h1>
                         {/* Icon removed for brevity, can be added back */}
                        <h2 style={{ color: '#333', fontSize: '24px', marginBottom: '10px' }}>
                            Hi, {interviewData?.candidateName || 'Candidate'}!
                        </h2>
                        <p style={{ color: '#666', fontSize: '18px', marginBottom: '5px' }}>
                            You're about to start your interview for:
                        </p>
                        <p style={{ color: '#ef402d', fontSize: '22px', fontWeight: 'bold', marginBottom: '30px' }}>
                            {interviewData?.jobTitle || 'Position'}
                        </p>
                    </div>

                    {/* Conditionally render PreInterviewCheck */}
                    {showChecks && <PreInterviewCheck onCheckComplete={handleCheckComplete} />}

                    {/* Instructions */}
                    <div style={{ backgroundColor: '#f0f0f0', padding: '20px', borderRadius: '8px', marginBottom: '30px' }}>
                         <h3 style={{ color: '#333', marginBottom: '15px' }}>Interview Steps:</h3>
                         <ol style={{ paddingLeft: '25px', color: '#555', lineHeight: '1.6' }}>
                             <li>System Check (Camera, Mic, Connection)</li>
                             <li>Identity Verification (Photo with ID)</li>
                             <li>Answer Interview Questions (Recorded)</li>
                         </ol>
                    </div>
                    <div style={{ backgroundColor: '#fffbf2', padding: '20px', borderRadius: '8px', marginBottom: '30px', borderLeft: '4px solid #f9a825' }}>
                        <h3 style={{ color: '#f9a825', marginBottom: '15px' }}>Important Note:</h3>
                        <p style={{ color: '#555' }}>
                            Once you start the identity verification, the interview is considered 'in progress'. Please ensure you are ready to proceed through all steps.
                        </p>
                    </div>

                    {/* Proceed Button */}
                    <div style={{ textAlign: 'center', marginTop: '30px' }}>
                        <button
                            onClick={handleProceed}
                            disabled={!checksPassed} // Disable if checks haven't passed
                            style={{
                                backgroundColor: checksPassed ? '#ef402d' : '#cccccc', // Grey out if disabled
                                color: 'white',
                                border: 'none',
                                padding: '14px 40px',
                                borderRadius: '4px',
                                fontSize: '18px',
                                fontWeight: 'bold',
                                cursor: checksPassed ? 'pointer' : 'not-allowed', // Change cursor
                                transition: 'background-color 0.3s',
                                opacity: checksPassed ? 1 : 0.6 // Reduce opacity if disabled
                            }}
                            // Inline hover effect handling
                            onMouseOver={e => { if (checksPassed) e.target.style.backgroundColor = '#d63020'; }}
                            onMouseOut={e => { if (checksPassed) e.target.style.backgroundColor = '#ef402d'; }}
                        >
                            {checksPassed === null ? 'Running Checks...' : 'Proceed to ID Verification'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Fallback for unexpected states (should ideally not be reached)
    return (
         <div>
            <InterviewHeader />
            <div style={{ padding: '40px', textAlign: 'center' }}>Unexpected state: {validationStatus}. Please contact support.</div>
         </div>
    );
}
export default InterviewLinkValidator;
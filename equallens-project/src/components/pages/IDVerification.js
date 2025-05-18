import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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


function IDVerification() {
    const { interviewId, linkCode } = useParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(false); // Initial validation happens before this page now
    const [error, setError] = useState(null); // General errors
    const [interviewData, setInterviewData] = useState(null); // Still useful to display job title etc.
    const [verifying, setVerifying] = useState(false);
    const [verificationResult, setVerificationResult] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    // Add new state for camera loading
    const [cameraLoading, setCameraLoading] = useState(false);

    // Image capture states
    const [capturedImage, setCapturedImage] = useState(null);
    const [method, setMethod] = useState('choose'); // 'choose', 'camera', or 'upload'

    // Refs
    const fileInputRef = useRef(null);
    const videoRef = useRef(null);
    const streamRef = useRef(null);

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

    // Validate the interview link on component mount
    useEffect(() => {
        const validateLink = async () => {
            try {
                setLoading(true);
                const response = await fetch(`http://localhost:8000/api/interviews/validate/${interviewId}/${linkCode}`);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || 'Invalid interview link');
                }

                const data = await response.json();
                setInterviewData(data);

                // If already verified, redirect to questions
                if (data.verificationCompleted) {
                    navigate(`/interview/${interviewId}/${linkCode}/questions`);
                }
            } catch (error) {
                console.error("Error validating interview link:", error);
                setError(error.message);
            } finally {
                setLoading(false);
            }
        };

        validateLink();

        // Cleanup function
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [interviewId, linkCode, navigate]);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                // Re-validate quickly to get candidate/job name if needed
                const response = await fetch(`http://localhost:8000/api/interviews/validate/${interviewId}/${linkCode}`);
                if (!response.ok) {
                    // Handle error if needed, maybe redirect back if invalid now
                    throw new Error("Failed to re-validate link.");
                }
                const data = await response.json();
                setInterviewData(data);
                // Important: Check if already verified *again* in case of browser back button etc.
                if (data.verificationCompleted || data.currentStatus !== 'pending') {
                     // If status is not pending anymore (e.g., in_progress, completed)
                     // or if verification somehow completed between validator and here
                     console.warn("Verification already completed or status not pending. Redirecting.");
                     navigate(`/interview/${interviewId}/${linkCode}/questions`);
                 }

            } catch (err) {
                console.error("Error fetching interview details:", err);
                setError("Could not load interview details. Please try again.");
            }
        };
        fetchDetails();
        // Cleanup camera on unmount
        return () => {
             if (streamRef.current) {
                 streamRef.current.getTracks().forEach(track => track.stop());
             }
         };
    }, [interviewId, linkCode, navigate]);

    // Add a dedicated effect to handle camera initialization
    useEffect(() => {
        // Only initialize camera when method is 'camera' and not already captured
        if (method === 'camera' && !capturedImage) {
            const initCamera = async () => {
                try {
                    setCameraLoading(true);

                    // Stop any existing stream
                    if (streamRef.current) {
                        streamRef.current.getTracks().forEach(track => track.stop());
                        streamRef.current = null;
                    }

                    // Request camera access
                    const stream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });

                    // Store the stream reference
                    streamRef.current = stream;

                    // Ensure videoRef is available before setting srcObject
                    if (videoRef.current) {
                        // Set the stream to the video element
                        videoRef.current.srcObject = stream;

                        // Wait for the video to be ready
                        await new Promise((resolve) => {
                            videoRef.current.onloadedmetadata = () => {
                                resolve();
                            };

                            // Fallback if loadedmetadata doesn't fire
                            setTimeout(resolve, 1000);
                        });

                        // Play the video
                        await videoRef.current.play();
                        console.log("Camera started successfully");
                    } else {
                        throw new Error("Video element not available");
                    }
                } catch (err) {
                    console.error("Error accessing camera:", err);
                    setErrorMessage("Could not access camera. Please use the file upload option instead.");
                    setMethod('upload');
                } finally {
                    setCameraLoading(false);
                }
            };

            initCamera();
        }

        // Clean up function to stop camera when component unmounts or method changes
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, [method, capturedImage]);

    // Handle file upload
    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setErrorMessage(null);

        // Check file type
        if (!file.type.match('image.*')) {
            setErrorMessage('Please select an image file (JPG, PNG, etc.)');
            return;
        }

        // Check file size (limit to 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setErrorMessage('Image file is too large. Please select an image under 5MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            setCapturedImage(e.target.result);
        };
        reader.onerror = () => {
            setErrorMessage('Error reading file. Please try another file.');
        };
        reader.readAsDataURL(file);
    };

    // Select verification method
    const selectMethod = (selectedMethod) => {
        setMethod(selectedMethod);
        setErrorMessage(null);
    };

    // Stop camera stream
    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    };

    // Capture photo from video stream - simplified approach
    const capturePhoto = () => {
        try {
            setErrorMessage(null);

            // Create a canvas element
            const canvas = document.createElement('canvas');
            const video = videoRef.current;

            if (!video || !streamRef.current) {
                setErrorMessage("Camera not ready. Please try again.");
                return;
            }

            // Use fixed dimensions if video dimensions aren't available
            const width = video.videoWidth || 640;
            const height = video.videoHeight || 480;

            canvas.width = width;
            canvas.height = height;

            // Draw video frame to canvas
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, width, height);

            // Convert canvas to base64 image
            try {
                const imageData = canvas.toDataURL('image/jpeg', 0.9);
                setCapturedImage(imageData);
                stopCamera();
            } catch (err) {
                console.error("Error converting canvas to image:", err);
                setErrorMessage("Error capturing image. Please try the file upload option.");
                setMethod('upload');
            }
        } catch (err) {
            console.error("Error capturing photo:", err);
            setErrorMessage("Error capturing photo. Please try the file upload option.");
            setMethod('upload');
        }
    };

    // Reset and go back to method selection
    const resetCapture = () => {
        setCapturedImage(null);
        setErrorMessage(null);
        setVerificationResult(null);
        setMethod('choose');
        if (streamRef.current) {
            stopCamera();
        }
    };

    // Submit photo for verification
    const submitVerification = async () => {
        if (!capturedImage) {
            setErrorMessage("No photo captured. Please take or upload a photo first.");
            return;
        }

        setVerifying(true);
        setErrorMessage(null);
        setVerificationResult(null); // Clear previous result

        try {
            const response = await fetch('http://localhost:8000/api/interviews/verify-identity', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    interviewId: interviewId,
                    linkCode: linkCode,
                    identificationImage: capturedImage
                })
            });

            const result = await response.json(); // Always parse JSON

            if (!response.ok) {
                // Use the detailed message from backend if available
                throw new Error(result.detail || 'Verification request failed');
            }

            console.log("Verification API Response:", result);
            setVerificationResult(result); // Store the detailed result

            // Redirect ONLY if overall verification is successful
            if (result.verified) {
                setTimeout(() => {
                    navigate(`/interview/${interviewId}/${linkCode}/questions`);
                }, 2500); // Slightly shorter delay maybe
            } else {
                // Error message is set based on result.message within the result display logic
                console.log("Verification failed. Details:", result.message);
            }

        } catch (error) {
            console.error("Error during verification submit:", error);
            // Display the caught error message
            setErrorMessage(error.message || "An unexpected error occurred during verification.");
            // Ensure verificationResult state reflects failure if API call failed badly
            setVerificationResult({
                verified: false,
                message: error.message || "An unexpected error occurred.",
                // Add default false values for detailed flags if needed by UI
                face_verified: false,
                name_verified: false
            });
        } finally {
            setVerifying(false);
        }
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
                <LoadingAnimation />
                <h2 style={{ marginTop: '30px', color: '#333' }}>Preparing verification...</h2>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                maxWidth: '600px',
                margin: '40px auto',
                padding: '30px',
                textAlign: 'center',
                backgroundColor: '#fff',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
            }}>
                <div style={{
                    width: '80px',
                    height: '80px',
                    backgroundColor: '#ffdddd',
                    borderRadius: '50%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    margin: '0 auto 20px'
                }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </div>
                <h2 style={{ color: '#e53935', marginBottom: '20px' }}>Error</h2>
                <p style={{ color: '#555', fontSize: '18px', marginBottom: '30px' }}>
                    {error}
                </p>
                <button
                    onClick={() => window.location.reload()}
                    style={{
                        backgroundColor: '#ef402d',
                        color: 'white',
                        border: 'none',
                        padding: '12px 30px',
                        borderRadius: '4px',
                        fontSize: '16px',
                        cursor: 'pointer'
                    }}
                >
                    Try Again
                </button>
            </div>
        );
    }

    // Show verification result
    if (verificationResult) {
        const isSuccess = verificationResult.verified; // Overall success
        const iconBgColor = isSuccess ? '#e8f5e9' : '#ffdddd';
        const iconStrokeColor = isSuccess ? '#4caf50' : '#e53935';
        const title = isSuccess ? 'Verification Successful' : 'Verification Failed';

        return (
            <div> {/* Wrapper for header */}
                <InterviewHeader />
                <div style={{ maxWidth: '600px', margin: '40px auto', padding: '30px', textAlign: 'center', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)' }}>
                    <div style={{ width: '80px', height: '80px', backgroundColor: iconBgColor, borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '0 auto 20px' }}>
                        {isSuccess ? (
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={iconStrokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        ) : (
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={iconStrokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="15" y1="9" x2="9" y2="15"></line>
                                <line x1="9" y1="9" x2="15" y2="15"></line>
                            </svg>
                        )}
                    </div>
                    <h2 style={{ color: iconStrokeColor, marginBottom: '20px' }}>
                        {title}
                    </h2>
                    {/* Display the message from the backend */}
                    <p style={{ color: '#555', fontSize: '18px', marginBottom: '30px', whiteSpace: 'pre-wrap' }}>
                        {verificationResult.message || (isSuccess ? "Proceeding to interview..." : "Please try again.")}
                    </p>

                    {/* Optional: Display detailed face/name status for failure */}
                    {!isSuccess && (
                         <div style={{ fontSize: '14px', color: '#666', marginBottom: '20px', padding: '10px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #eee' }}>
                              {verificationResult.face_verified === false && <span>Face match failed. </span>}
                              {verificationResult.name_verified === false && <span>Name verification failed.</span>}
                              {/* You could add more details from debug_info if needed */}
                         </div>
                    )}

                    {isSuccess ? (
                        <p style={{ color: '#4caf50', fontSize: '16px' }}>
                            Redirecting to interview questions...
                        </p>
                    ) : (
                        <button
                            onClick={resetCapture} // Use resetCapture to go back to selection/capture
                            style={{
                                backgroundColor: '#ef402d',
                                color: 'white',
                                border: 'none',
                                padding: '12px 30px',
                                borderRadius: '4px',
                                fontSize: '16px',
                                cursor: 'pointer'
                            }}
                        >
                            Try Again
                        </button>
                    )}
                </div>
            </div>
        );
    }


    return (
        <div>
            <InterviewHeader />
            <div style={{
                maxWidth: '800px',
                margin: '40px auto',
                padding: '30px',
                backgroundColor: '#fff',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h1 style={{ color: '#ef402d', fontSize: '28px', marginBottom: '20px' }}>Identity Verification</h1>
                    {interviewData && (
                        <p style={{ color: '#666', fontSize: '18px' }}>
                            For: <span style={{ color: '#ef402d', fontWeight: 'bold' }}>{interviewData.jobTitle}</span>
                        </p>
                    )}
                </div>

                <div style={{
                    backgroundColor: '#f9f9f9',
                    padding: '20px',
                    borderRadius: '8px',
                    marginBottom: '30px'
                }}>
                    <h3 style={{ color: '#333', marginBottom: '15px' }}>Instructions:</h3>
                    <ol style={{ paddingLeft: '25px', color: '#555', lineHeight: '1.6' }}>
                        <li>Take a photo of yourself holding your ID card/passport</li>
                        <li>Make sure the id photo is near enough with the camera</li>
                        <li>Ensure both your face and ID are clearly visible</li>
                        <li>Make sure the ID text is readable</li>
                        <li>You can use your camera or upload a pre-taken photo</li>
                    </ol>
                </div>

                {/* Error message */}
                {errorMessage && (
                    <div style={{
                        backgroundColor: '#ffdddd',
                        color: '#e53935',
                        padding: '15px',
                        borderRadius: '8px',
                        marginBottom: '20px',
                        textAlign: 'center'
                    }}>
                        <p style={{ margin: 0 }}>{errorMessage}</p>
                    </div>
                )}

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    marginBottom: '30px'
                }}>
                    {/* Method selection screen */}
                    {method === 'choose' && !capturedImage && (
                        <div style={{
                            width: '100%',
                            maxWidth: '500px',
                            padding: '20px',
                            backgroundColor: '#f5f5f5',
                            borderRadius: '8px',
                            marginBottom: '20px'
                        }}>
                            <h3 style={{ textAlign: 'center', marginBottom: '20px' }}>Choose Verification Method</h3>
                            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                                <button
                                    onClick={() => selectMethod('camera')}
                                    style={{
                                        flex: 1,
                                        backgroundColor: '#ef402d',
                                        color: 'white',
                                        border: 'none',
                                        padding: '30px 15px',
                                        borderRadius: '8px',
                                        fontSize: '16px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                >
                                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                                        <circle cx="12" cy="13" r="4"></circle>
                                    </svg>
                                    Use Camera
                                </button>
                                <button
                                    onClick={() => selectMethod('upload')}
                                    style={{
                                        flex: 1,
                                        backgroundColor: '#2196f3',
                                        color: 'white',
                                        border: 'none',
                                        padding: '30px 15px',
                                        borderRadius: '8px',
                                        fontSize: '16px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '10px'
                                    }}
                                >
                                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="17 8 12 3 7 8"></polyline>
                                        <line x1="12" y1="3" x2="12" y2="15"></line>
                                    </svg>
                                    Upload Photo
                                </button>
                            </div>
                        </div>
                    )}

                    {/* File upload screen */}
                    {method === 'upload' && !capturedImage && (
                        <div style={{
                            width: '100%',
                            maxWidth: '500px',
                            textAlign: 'center',
                            marginBottom: '20px'
                        }}>
                            <div style={{
                                border: '2px dashed #ccc',
                                borderRadius: '8px',
                                padding: '40px 20px',
                                marginBottom: '20px',
                                backgroundColor: '#f9f9f9'
                            }}>
                                <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                                <p style={{ color: '#666', marginTop: '15px', marginBottom: '15px' }}>
                                    Upload a photo of yourself holding your ID
                                </p>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                />
                                <button
                                    onClick={() => fileInputRef.current.click()}
                                    style={{
                                        backgroundColor: '#2196f3',
                                        color: 'white',
                                        border: 'none',
                                        padding: '12px 30px',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Select Photo
                                </button>
                            </div>
                            <button
                                onClick={() => selectMethod('choose')}
                                style={{
                                    backgroundColor: '#f5f5f5',
                                    color: '#333',
                                    border: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '4px',
                                    fontSize: '14px',
                                    cursor: 'pointer'
                                }}
                            >
                                Back to Methods
                            </button>
                        </div>
                    )}

                    {/* Camera view */}
                    {method === 'camera' && !capturedImage && (
                        // Outer wrapper div to control max-width and centering
                        <div style={{
                            width: '100%',
                            maxWidth: '500px',     // Limits the maximum size
                            margin: '0 auto 20px auto', // Centers the block horizontally, adds bottom margin
                            // No border needed here usually
                        }}>
                            {/* Aspect Ratio Container: This div defines the shape and relative positioning context */}
                            <div style={{
                                position: 'relative',      // Needed for the absolutely positioned video inside
                                width: '100%',             // Takes full width of the outer wrapper
                                paddingTop: '75%',         // Creates height relative to width (e.g., 75% = 4:3 aspect ratio). Use '56.25%' for 16:9.
                                backgroundColor: '#000',   // Shows if video doesn't cover (e.g., with objectFit: 'contain')
                                borderRadius: '8px',       // Optional: For rounded corners
                                overflow: 'hidden',        // Keeps the video contained within the rounded corners/bounds
                                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)' // Optional: visual styling
                            }}>
                                {cameraLoading && (
                                    // Simple overlay example for loading state
                                    <div style={{
                                        position: 'absolute',
                                        top: 0, left: 0, right: 0, bottom: 0, // Cover the container
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        backgroundColor: 'rgba(0, 0, 0, 0.7)', // Semi-transparent background
                                        color: 'white',
                                        zIndex: 2 // Ensure it's above the video
                                    }}>
                                        {/* Add your LoadingAnimation or text here */}
                                        Loading Camera...
                                    </div>
                                )}
                                {/* Video Element: Positioned absolutely to fill the container */}
                                <video
                                    ref={videoRef}
                                    autoPlay
                                    playsInline
                                    muted
                                    style={{
                                        position: 'absolute',  // Position relative to the container above
                                        top: 0,
                                        left: 0,
                                        width: '100%',         // Fill the container width
                                        height: '100%',        // Fill the container height (created by paddingTop)
                                        display: 'block',      // Removes potential extra space below video
                                        objectFit: 'cover',    // 'cover' fills space (may crop), 'contain' fits all (may letterbox)
                                        zIndex: 1,          // Ensure it's below the loading overlay
                                        transform: 'scaleX(-1)'
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '20px' }}>
                                <button
                                    onClick={() => selectMethod('choose')}
                                    style={{
                                        backgroundColor: '#f5f5f5',
                                        color: '#333',
                                        border: 'none',
                                        padding: '10px 20px',
                                        borderRadius: '4px',
                                        fontSize: '14px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Back
                                </button>
                                <button
                                    onClick={capturePhoto}
                                    disabled={cameraLoading}
                                    style={{
                                        backgroundColor: '#ef402d',
                                        color: 'white',
                                        border: 'none',
                                        padding: '12px 30px',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                        cursor: cameraLoading ? 'not-allowed' : 'pointer',
                                        opacity: cameraLoading ? 0.7 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                    Take Photo
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Captured image review */}
                    {capturedImage && (
                        <div style={{
                            width: '100%',
                            maxWidth: '500px',
                            marginBottom: '20px'
                        }}>
                            <div style={{
                                width: '100%',
                                borderRadius: '8px',
                                overflow: 'hidden',
                                marginBottom: '20px',
                                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)'
                            }}>
                                <img
                                    src={capturedImage}
                                    alt="Verification"
                                    style={{
                                        width: '100%',
                                        height: 'auto',
                                        display: 'block'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                                <button
                                    onClick={resetCapture}
                                    style={{
                                        backgroundColor: '#f5f5f5',
                                        color: '#333',
                                        border: 'none',
                                        padding: '12px 24px',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Try Again
                                </button>
                                <button
                                    onClick={submitVerification}
                                    disabled={verifying}
                                    style={{
                                        backgroundColor: '#4caf50',
                                        color: 'white',
                                        border: 'none',
                                        padding: '12px 30px',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                        cursor: verifying ? 'not-allowed' : 'pointer',
                                        opacity: verifying ? 0.7 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    {verifying ? (
                                        <>
                                            <span style={{
                                                display: 'inline-block',
                                                width: '16px',
                                                height: '16px',
                                                border: '2px solid rgba(255,255,255,0.3)',
                                                borderTopColor: 'white',
                                                borderRadius: '50%',
                                                animation: 'spin 1s linear infinite'
                                            }}></span>
                                            <style>{`
                                            @keyframes spin {
                                                to { transform: rotate(360deg); }
                                            }
                                        `}</style>
                                            Verifying...
                                        </>
                                    ) : (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                            </svg>
                                            Submit for Verification
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{
                    backgroundColor: '#fffbf2',
                    padding: '20px',
                    borderRadius: '8px',
                    borderLeft: '4px solid #f9a825'
                }}>
                    <h3 style={{ color: '#f9a825', marginBottom: '15px' }}>Privacy Notice:</h3>
                    <p style={{ color: '#555' }}>
                        Your photo will only be used for identity verification purposes and will be stored securely.
                        We will not use this image for any other purpose without your explicit consent.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default IDVerification;
import React, { useState, useEffect, useRef, useContext, createContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './InterviewResponses.css';
import '../pageloading.css';

// Create a context for managing audio players
const AudioPlayerContext = createContext();

// Provider component to manage audio players
const AudioPlayerProvider = ({ children }) => {
    const [currentlyPlaying, setCurrentlyPlaying] = useState(null);

    const pauseOthers = (id) => {
        if (currentlyPlaying && currentlyPlaying !== id) {
            setCurrentlyPlaying(id);
        } else {
            setCurrentlyPlaying(id);
        }
    };

    return (
        <AudioPlayerContext.Provider value={{ currentlyPlaying, pauseOthers }}>
            {children}
        </AudioPlayerContext.Provider>
    );
};

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

// --- XAI Explanation Component ---
const XAIExplanation = ({ explanationData, metricName }) => {
    if (!explanationData || !explanationData[metricName] || explanationData[metricName].length === 0) {
        return <p>No detailed explanation available for {metricName}.</p>;
    }

    // Simple formatting for explanations
    return (
        <div className="xai-explanation">
            <h4>Explanation for {metricName.charAt(0).toUpperCase() + metricName.slice(1)}:</h4>
            <ul>
                {explanationData[metricName].map((exp, index) => (
                    <li key={index} style={{ color: exp.includes('Positively') ? '#388e3c' : '#d32f2f', marginBottom: '4px' }}>
                        {exp}
                    </li>
                ))}
            </ul>
        </div>
    );
};

// New component for displaying performance metrics
const PerformanceAnalysis = ({ analysis, explanations }) => {
    // State to control visibility of XAI details
    const [showXaiDetails, setShowXaiDetails] = useState(false);

    // --- NOW, handle conditional return ---
    if (!analysis) {
        return (
            <div className="performance-analysis empty-analysis">
                <p>No performance analysis data available.</p>
            </div>
        );
    }

    const weights = {
        relevance: 0.15,
        clarity: 0.20,
        confidence: 0.20,
        engagement: 0.15,
        substance: 0.15, // NEW
        jobFit: 0.15     // NEW
    };

    const criterionColors = {
        relevance: '#f87171', // Light red (Tailwind red-400)
        clarity: '#34d399',   // Teal/Emerald (Tailwind emerald-400)
        confidence: '#60a5fa', // Light blue (Tailwind blue-400)
        engagement: '#c084fc', // Light purple (Tailwind purple-400)
        substance: '#facc15',  // Amber/Yellow (Tailwind yellow-400) - NEW
        jobFit: '#4ade80'     // Green (Tailwind green-400) - NEW
    };

    const getScoreColor = (score) => {
        if (score >= 0.7) return '#4caf50';
        if (score >= 0.4) return '#ff9800';
        return '#f44336';
    };

    const formatScore = (score) => {
        const numericScore = Number(score);
        if (isNaN(numericScore)) {
            return 'N/A'; // Or some other placeholder
        }
        return `${(numericScore * 100).toFixed(1)}%`;
    };

    if (!analysis) {
        return (
            <div className="performance-analysis empty-analysis">
                <p>No performance analysis data available.</p>
            </div>
        );
    }

    const getGrade = (score) => {
        if (score >= 0.8) return 'A';
        if (score >= 0.7) return 'B';
        if (score >= 0.6) return 'C';
        if (score >= 0.5) return 'D';
        if (score >= 0.4) return 'E';
        return 'F';
    };

    // Helper to safely access nested properties
     const getSafe = (obj, path, defaultValue = 0) => {
        return path.split('.').reduce((acc, key) => (acc && acc[key] != null) ? acc[key] : defaultValue, obj);
    };

// --- Updated analysisData extraction ---
    const analysisData = {
        clarity: getSafe(analysis, 'clarity', 0),
        confidence: getSafe(analysis, 'confidence', 0),
        engagement: getSafe(analysis, 'engagement', 0),
        relevance: getSafe(analysis, 'relevance', 0),
        substance: getSafe(analysis, 'substance', 0), // NEW
        jobFit: getSafe(analysis, 'jobFit', 0),     // NEW
        totalScore: getSafe(analysis, 'totalScore', 0)
    };

    // --- Updated calculations for contributions ---
    const safeWeights = {
        clarity: weights.clarity || 0.01,
        confidence: weights.confidence || 0.01,
        engagement: weights.engagement || 0.01,
        relevance: weights.relevance || 0.01,
        substance: weights.substance || 0.01, // NEW
        jobFit: weights.jobFit || 0.01     // NEW
    };

    const rawContributions = {
        clarity: analysisData.clarity * safeWeights.clarity,
        confidence: analysisData.confidence * safeWeights.confidence,
        engagement: analysisData.engagement * safeWeights.engagement,
        relevance: analysisData.relevance * safeWeights.relevance,
        substance: analysisData.substance * safeWeights.substance, // NEW
        jobFit: analysisData.jobFit * safeWeights.jobFit         // NEW
    };

    const sumRawContributions = Object.values(rawContributions).reduce((sum, val) => sum + val, 0);

    // Default to equal distribution if sum is 0 to avoid NaN/Infinity
    const numCriteria = Object.keys(safeWeights).length;
    const defaultProportion = 1 / numCriteria;

    const relativeContributions = sumRawContributions > 1e-6 ? { // Use a small threshold
        clarity: rawContributions.clarity / sumRawContributions,
        confidence: rawContributions.confidence / sumRawContributions,
        engagement: rawContributions.engagement / sumRawContributions,
        relevance: rawContributions.relevance / sumRawContributions,
        substance: rawContributions.substance / sumRawContributions, // NEW
        jobFit: rawContributions.jobFit / sumRawContributions         // NEW
    } : { // Assign default proportions if sum is near zero
        clarity: defaultProportion, confidence: defaultProportion, engagement: defaultProportion,
        relevance: defaultProportion, substance: defaultProportion, jobFit: defaultProportion
    };


    const totalScore = analysisData.totalScore || 0;

     return (
        <div className="performance-analysis">
            <div className="performance-header">
                <h2>Overall Performance Analysis</h2>
                {typeof analysisData.totalScore === 'number' && (
                    <div className="overall-score">
                         {/* Use totalScore for the badge */}
                        <div className="score-badge" style={{ backgroundColor: getScoreColor(analysisData.totalScore) }}>
                            {getGrade(analysisData.totalScore)}
                        </div>
                        <span className="overall-score-percentage">
                            {formatScore(analysisData.totalScore)}
                        </span>
                    </div>
                 )}
            </div>

             {/* Stacked Bar Chart */}
             <div className="overall-score-composition">
                <h3>Overall Score Composition</h3>
                <div className="score-composition-container">
                    <div className="stacked-bar-outer">
                         {/* Use totalScore for the bar width */}
                        <div
                            className="stacked-bar-chart"
                            style={{
                                width: `${analysisData.totalScore * 100}%`,
                                '--final-width': `${analysisData.totalScore * 100}%`
                            }}
                        >
                             {/* Map over ALL criteria defined in criterionColors */}
                            {Object.keys(criterionColors).map((criterion) => {
                                const proportion = relativeContributions[criterion] || 0; // Get proportion safely
                                const scoreValue = analysisData[criterion] || 0; // Get score safely
                                const criterionWeight = weights[criterion] || 0; // Get weight safely
                                const contributionValue = scoreValue * criterionWeight; // Calculate actual contribution

                                // Only render the segment if its proportion is > 0
                                if (proportion > 1e-6) {
                                    return (
                                        <div
                                            key={criterion}
                                            className="stacked-segment"
                                            style={{
                                                width: `${proportion * 100}%`,
                                                backgroundColor: criterionColors[criterion],
                                            }}
                                            // Updated tooltip to show score, weight, and contribution
                                            title={`${criterion.charAt(0).toUpperCase() + criterion.slice(1)}: ${formatScore(scoreValue)} | Weight: ${(criterionWeight * 100).toFixed(0)}% | Contrib: ${(contributionValue * 100).toFixed(1)}%`}
                                        ></div>
                                    );
                                }
                                return null; // Don't render zero-width segments
                            })}
                        </div>
                    </div>
                    <div className="scale-markers">
                        <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                    </div>
                </div>
                <div className="chart-legend">
                     {/* Map over ALL criteria defined in criterionColors for the legend */}
     {Object.keys(criterionColors).map((criterion) => (
        <div key={criterion} className="legend-item">
            {/* This div should get the background color */}
            <div className="legend-color" style={{ backgroundColor: criterionColors[criterion] }}></div>
            <span className="legend-label">
                {criterion.charAt(0).toUpperCase() + criterion.slice(1)}: {formatScore(analysisData[criterion])}
                {` (${(weights[criterion] * 100).toFixed(0)}%)`} {/* Show Weight */}
            </span>
        </div>
    ))}
                </div>
            </div>

            {/* Individual Metrics/Achievement Charts */}
            <div className="metrics-container">
                 {/* Map over ALL criteria defined in criterionColors */}
                 {Object.keys(criterionColors).map((criterion) => {
                    const score = analysisData[criterion] || 0;
                    const weight = weights[criterion] || 0;
                    const scorePercent = score * 100;

                    return (
                        <div key={criterion} className="metric-item">
                            <div className="metric-header">
                                <h4>{criterion.charAt(0).toUpperCase() + criterion.slice(1)}</h4>
                                <div className="metric-scores">
                                    <span className="achievement-score" style={{ color: getScoreColor(score) }}>
                                        {scorePercent.toFixed(1)}%
                                    </span>
                                     {/* Display individual score and weight */}
                                    <span className="weighted-score">
                                        Score: {score.toFixed(2)} | Weightage: {(weight * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                            <div className="achievement-chart">
                                <div className="achievement-bar-container">
                                    <div
                                        className="achievement-bar"
                                        style={{
                                            width: `${scorePercent}%`,
                                            backgroundColor: criterionColors[criterion],
                                            '--final-width': `${scorePercent}%`
                                        }}
                                        title={`${criterion.charAt(0).toUpperCase() + criterion.slice(1)}: ${scorePercent.toFixed(1)}%`}
                                    >
                                        <span className="achievement-bar-label">
                                            {scorePercent.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>
                                <div className="achievement-scale">
                                    <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                                </div>
                            </div>
                            <p className="metric-description">
                                {criterion === 'clarity' && 'How clearly ideas are communicated.'}
                                {criterion === 'confidence' && 'Level of certainty and assertiveness shown.'}
                                {criterion === 'engagement' && 'Level of energy and enthusiasm in responses.'}
                                {criterion === 'relevance' && 'How well responses address the questions asked.'}
                                {criterion === 'substance' && 'Depth and quality of the answer content.'} {/* NEW */}
                                {criterion === 'jobFit' && 'Alignment of the answer with job requirements.'} {/* NEW */}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* Analysis Interpretation */}
            <div className="analysis-interpretation">
                <h3>Analysis Interpretation</h3>
                <ul>
                    {/* Existing interpretations */}
                    {analysisData.relevance < 0.3 && <li>Candidate's responses need to more directly address the questions asked.</li>}
                    {analysisData.clarity < 0.3 && <li>Candidate should work on expressing ideas more clearly and concisely.</li>}
                    {analysisData.confidence < 0.3 && <li>Candidate could benefit from more confident delivery of responses.</li>}
                    {analysisData.engagement < 0.3 && <li>Candidate's responses lack sufficient energy and enthusiasm.</li>}

                    {/* NEW interpretations for substance and jobFit */}
                    {analysisData.substance < 0.4 && <li>Response lacks sufficient depth or specific examples relevant to the role.</li>}
                    {analysisData.jobFit < 0.4 && <li>Answer shows limited alignment with the specific requirements of the job description.</li>}

                    {/* Overall score interpretations */}
                    {totalScore < 0.5 && <li>Overall performance is below expectations for this position.</li>}
                    {totalScore >= 0.5 && totalScore < 0.7 && <li>Performance is satisfactory with potential areas for growth.</li>}
                    {totalScore >= 0.7 && totalScore < 0.9 && <li>Overall performance demonstrates strong interview skills and good potential fit.</li>}
                    {totalScore >= 0.9 && <li>Exceptional performance with excellent communication skills and strong job alignment.</li>}

                    {/* High score interpretations */}
                    {analysisData.relevance >= 0.9 && <li>Candidate shows outstanding ability to provide highly relevant responses.</li>}
                    {analysisData.clarity >= 0.9 && <li>Exceptional clarity in communication and well-structured answers.</li>}
                    {analysisData.confidence >= 0.9 && <li>Demonstrates remarkable confidence and assertiveness.</li>}
                    {analysisData.engagement >= 0.9 && <li>Shows excellent engagement and enthusiasm.</li>}
                    {analysisData.substance >= 0.8 && <li>Candidate provides insightful and detailed answers demonstrating strong understanding.</li>} {/* NEW */}
                    {analysisData.jobFit >= 0.8 && <li>Response strongly indicates a good fit for the job based on content provided.</li>} {/* NEW */}
                </ul>
            </div>

            {/* XAI Details Section */}
            {explanations && Object.keys(explanations).length > 0 && (
                <div className="xai-details-section">
                    <button onClick={() => setShowXaiDetails(!showXaiDetails)} className="xai-toggle-button">
                        {showXaiDetails ? 'Hide Overall Scoring Details' : 'Show Overall Scoring Details'}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showXaiDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
                           <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div className={`xai-content ${showXaiDetails ? 'expanded' : 'collapsed'}`}>
                         {showXaiDetails && (
                            <>
                                <XAIExplanation explanationData={explanations} metricName="relevance" />
                                <XAIExplanation explanationData={explanations} metricName="confidence" />
                                <XAIExplanation explanationData={explanations} metricName="clarity" />
                                <XAIExplanation explanationData={explanations} metricName="engagement" />
                                {/* NEW: Display Substance and Job Fit Reasoning */}
                                {explanations.substance && explanations.substance.length > 0 && (
                                    <div className="xai-explanation gemini-reasoning">
                                        <h4>Explanation for Substance:</h4>
                                        <p>{explanations.substance[0]}</p> {/* Display the first (and likely only) reasoning string */}
                                    </div>
                                )}
                                {explanations.jobFit && explanations.jobFit.length > 0 && (
                                    <div className="xai-explanation gemini-reasoning">
                                        <h4>Explanation for Job Fit:</h4>
                                        <p>{explanations.jobFit[0]}</p> {/* Display the first (and likely only) reasoning string */}
                                    </div>
                                )}
                                <p style={{fontSize: '0.8em', color: '#666', marginTop: '15px', fontStyle: 'italic'}}>
                                    *Note: Overall scores are calculated based on linguistic, audio, and content analysis across all responses. Explanations highlight key contributing factors.*
                                </p>
                            </>
                         )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper function to check if a character index is within any censored segment
// This can be kept in InterviewResponses.js or moved to a utils file if preferred
const isCharIndexCensored = (charIndex, detectedSegments) => {
    if (!detectedSegments || detectedSegments.length === 0) {
        return false;
    }
    for (const seg of detectedSegments) {
        if (charIndex >= seg.start_char_index && charIndex < seg.end_char_index) {
            return true;
        }
    }
    return false;
};



const AudioPlayer = ({ audioUrl, transcript, wordTimings, onTimeUpdate, playerId }) => {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [audioStatus, setAudioStatus] = useState("initial");

    const { currentlyPlaying, pauseOthers } = useContext(AudioPlayerContext);

    useEffect(() => {
        if (audioRef.current && isPlaying && currentlyPlaying !== playerId) {
            audioRef.current.pause();
            setIsPlaying(false);
        }
    }, [currentlyPlaying, playerId, isPlaying]);

    useEffect(() => {
        if (!audioUrl) {
            setError("No audio URL provided");
            setLoading(false);
            setAudioStatus("error");
            return;
        }

        setLoading(true);
        setError(null);
        setDuration(0);
        setCurrentTime(0);
        setIsPlaying(false);
        setAudioStatus("loading");

        const testAudio = new Audio();

        const handleTestCanPlay = () => {
            setAudioStatus("ready");
            setLoading(false);
            testAudio.removeEventListener('canplay', handleTestCanPlay);
            testAudio.removeEventListener('error', handleTestError);
        };

        const handleTestError = (e) => {
            let errorMessage = "Audio file could not be loaded";
            if (e.target.error) {
                switch (e.target.error.code) {
                    case 1:
                        errorMessage = "Audio loading aborted";
                        break;
                    case 2:
                        errorMessage = "Network error while loading audio";
                        break;
                    case 3:
                        errorMessage = "Audio decoding error - file might be corrupted or unsupported format";
                        break;
                    case 4:
                        errorMessage = "Audio format not supported by your browser";
                        break;
                    default:
                        errorMessage = `Unknown audio error (${e.target.error.code})`;
                }
            }
            setError(errorMessage);
            setLoading(false);
            setAudioStatus("error");
            testAudio.removeEventListener('canplay', handleTestCanPlay);
            testAudio.removeEventListener('error', handleTestError);
        };

        testAudio.addEventListener('canplay', handleTestCanPlay);
        testAudio.addEventListener('error', handleTestError);

        testAudio.src = audioUrl;
        testAudio.load();

        return () => {
            testAudio.removeEventListener('canplay', handleTestCanPlay);
            testAudio.removeEventListener('error', handleTestError);
            testAudio.src = '';
        };
    }, [audioUrl]);

    useEffect(() => {
        if (audioStatus === "ready" && audioRef.current) {
            const audio = audioRef.current;

            const handleLoadedMetadata = () => {
                setDuration(audio.duration);
            };

            const handleTimeUpdate = () => {
                setCurrentTime(audio.currentTime);
                if (onTimeUpdate) {
                    onTimeUpdate(audio.currentTime);
                }
            };

            const handleEnded = () => {
                setIsPlaying(false);
                setCurrentTime(0);
                if (onTimeUpdate) {
                    onTimeUpdate(0);
                }
            };

            audio.addEventListener('loadedmetadata', handleLoadedMetadata);
            audio.addEventListener('timeupdate', handleTimeUpdate);
            audio.addEventListener('ended', handleEnded);

            return () => {
                audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
                audio.removeEventListener('timeupdate', handleTimeUpdate);
                audio.removeEventListener('ended', handleEnded);
            };
        }
    }, [audioStatus, onTimeUpdate]);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                pauseOthers(playerId);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        setError("Playback failed - try using the direct download link");
                    });
                }
                setIsPlaying(true);
            }
        }
    };

    const resetPlay = () => {
        if (audioRef.current) {
            pauseOthers(playerId);
            audioRef.current.currentTime = 0;
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    setError("Playback failed - try using the direct download link");
                    setIsPlaying(false);
                });
            }
            setIsPlaying(true);
        }
    };

    const handleProgressChange = (e) => {
        if (audioRef.current) {
            const newTime = parseFloat(e.target.value);
            audioRef.current.currentTime = newTime;
            setCurrentTime(newTime);
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    if (loading) {
        return (
            <div className="audio-loading">
                Loading audio...
                <button onClick={() => window.open(audioUrl, '_blank')}
                    style={{
                        marginLeft: '10px', background: 'none', border: 'none',
                        color: '#0066cc', cursor: 'pointer', textDecoration: 'underline'
                    }}>
                    Open directly
                </button>
            </div>
        );
    }

    if (error) {
        return (
            <div className="audio-error">
                <div>{error}</div>
                <div style={{ marginTop: '10px' }}>
                    <button onClick={() => window.open(audioUrl, '_blank')}
                        style={{
                            background: '#0066cc', color: 'white', border: 'none',
                            padding: '5px 10px', borderRadius: '4px', cursor: 'pointer'
                        }}>
                        Download audio file
                    </button>
                </div>
                <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
                    <p>The audio file may be in WAV format, which some browsers have trouble playing directly.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="audio-player">
            <audio ref={audioRef} src={audioUrl} preload="auto" />

            <div className="audio-controls">
                <button className="audio-button" onClick={togglePlay}>
                    {isPlaying ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    )}
                </button>

                <button className="audio-button" onClick={resetPlay}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="19 20 9 12 19 4 19 20"></polygon>
                        <line x1="5" y1="19" x2="5" y2="5"></line>
                    </svg>
                </button>

                <div className="audio-progress-container">
                    <input
                        type="range"
                        min="0"
                        max={duration || 0}
                        value={currentTime || 0}
                        onChange={handleProgressChange}
                        className="audio-progress"
                    />
                    <div className="audio-time">
                        <span>{formatTime(currentTime || 0)}</span>
                        <span>{formatTime(duration || 0)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SynchronizedTranscript = ({ transcript, wordTimings, currentTime, detectedSegments }) => {
    // Fallback if wordTimings are not available, display statically censored transcript
    if (!wordTimings || wordTimings.length === 0) {
        if (transcript && detectedSegments && detectedSegments.length > 0) {
            let chars = transcript.split('');
            for (let i = 0; i < chars.length; i++) {
                if (isCharIndexCensored(i, detectedSegments)) {
                    chars[i] = '#';
                }
            }
            const censoredStaticTranscript = chars.join('');
            const parts = censoredStaticTranscript.split(/(#+)/).filter(Boolean); // Split and remove empty strings
            return (
                <div className="transcript-text">
                    {parts.map((part, i) =>
                        /^#+$/.test(part) ? <span key={i} className="censored-text-segment">{part}</span> : part
                    )}
                </div>
            );
        }
        return <div className="transcript-text">{transcript || "Transcript not available."}</div>;
    }

    let globalCharIndex = 0; // To map word indices to character indices in the original full transcript

    return (
        <div className="transcript-text synchronized">
            {wordTimings.map((wordInfo, idx) => {
                const originalWordText = wordInfo.word;
                const wordStartCharIndex = globalCharIndex;
                globalCharIndex += originalWordText.length; // End of current word

                let displayWord = "";
                let isAnyCharCensored = false;

                for (let i = 0; i < originalWordText.length; i++) {
                    const currentCharAbsoluteIndex = wordStartCharIndex + i;
                    if (isCharIndexCensored(currentCharAbsoluteIndex, detectedSegments)) {
                        displayWord += '#';
                        isAnyCharCensored = true;
                    } else {
                        displayWord += originalWordText[i];
                    }
                }

                // Account for space after the word for the next word's globalCharIndex
                // (assuming wordTimings don't include trailing spaces in wordInfo.word)
                if (idx < wordTimings.length -1) { // If not the last word
                    globalCharIndex += 1; // Add 1 for the space
                }


                const highlightClass = (currentTime >= (wordInfo.startTime || 0) && currentTime <= (wordInfo.endTime || 0))
                    ? "highlighted-word"
                    : "";

                return (
                    <span
                        key={idx}
                        className={`${highlightClass} ${isAnyCharCensored ? "censored-text-segment" : ""}`}
                        data-start={wordInfo.startTime}
                        data-end={wordInfo.endTime}
                    >
                        {displayWord}{' '}
                    </span>
                );
            })}
        </div>
    );
};

const FacialInterpretation = ({ interpretation }) => {
     if (!interpretation || interpretation === "Processing..." || interpretation.startsWith("Error") || interpretation.startsWith("Facial expression data not available") || interpretation.startsWith("Could not interpret") || interpretation.startsWith("Interpretation skipped") || interpretation.startsWith("Failed to generate")) {
        return (
            <div className="facial-interpretation-section feedback-loading" style={{ marginTop: '1.5rem', padding: '1rem', color: '#718096', fontStyle: 'italic', borderLeft: '3px solid #fbbf24', backgroundColor: 'rgba(251, 191, 36, 0.05)', marginLeft: '16px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', animation: 'spin 2s linear infinite' }}>
                     <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <p style={{ margin: 0 }}>{interpretation || "Generating interpretation..."}</p>
                 <style>{`
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className="facial-interpretation-section" style={{ marginTop: '1.5rem' }}>
             <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div
                    style={{
                        backgroundColor: 'rgba(167, 139, 250, 0.1)', // Violet color base
                        color: '#7c3aed', // Violet 600
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '10px',
                        flexShrink: 0
                    }}
                >
                     {/* Brain / AI icon */}
                     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9.06 2.2C8.07 2.64 7.17 3.25 6.4 4 M4.01 6.4C3.25 7.17 2.64 8.07 2.2 9.06 M2.2 14.94c.44.99 1.05 1.89 1.81 2.66 M6.4 19.99c.77.76 1.67 1.37 2.66 1.81 M14.94 21.8c.99-.44 1.89-1.05 2.66-1.81 M19.99 17.6c.76-.77 1.37-1.67 1.81-2.66 M21.8 9.06c-.44-.99-1.05-1.89-1.81-2.66 M17.6 4.01c-.77-.76-1.67-1.37-2.66-1.81 M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z M12 18v3 M12 3v3 M18 12h3 M3 12h3 M19.07 4.93l-2.12 2.12 M4.93 19.07l2.12-2.12 M19.07 19.07l-2.12-2.12 M4.93 4.93l2.12 2.12"/>
                    </svg>
                </div>
                 <h4 style={{ color: '#4a5568', margin: 0, fontSize: '1rem', fontWeight: '600' }}>
                    AI Interpretation of Facial Expressions
                </h4>
            </div>
             <div className="interpretation-content" style={{
                backgroundColor: 'rgba(167, 139, 250, 0.05)',
                borderLeft: '3px solid #8b5cf6', // Violet 500
                borderRadius: '0 4px 4px 0',
                padding: '1.25rem',
                color: '#333',
                lineHeight: '1.6'
             }}>
                <p style={{ margin: 0 }}>{interpretation}</p>
                 <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '10px', fontStyle: 'italic' }}>
                    Note: This interpretation is based solely on automated analysis of facial expression likelihoods detected in the video and may not fully reflect the candidate's actual state.
                </p>
            </div>
        </div>
    );
};

const SchedulePhysicalInterviewModal = ({ isOpen, onClose, onConfirm, jobTitle, candidateName }) => {
    const [interviewDate, setInterviewDate] = useState('');
    const [interviewTime, setInterviewTime] = useState('');
    const [interviewLocation, setInterviewLocation] = useState('');
    const [contactPerson, setContactPerson] = useState('');
    const [additionalInfo, setAdditionalInfo] = useState(''); // Optional field
    const [error, setError] = useState('');

    const handleConfirm = () => {
        if (!interviewDate || !interviewTime || !interviewLocation || !contactPerson) {
            setError('Please fill in all required fields (Date, Time, Location, Contact Person).');
            return;
        }
        setError('');
        onConfirm({
            date: interviewDate,
            time: interviewTime,
            location: interviewLocation,
            contact: contactPerson,
            additionalInfo: additionalInfo
        });
    };

    const handleClose = () => {
        setError(''); // Clear error on close
        onClose();
    }

    if (!isOpen) return null;

    return (
        <div className="status-modal-overlay">
            <div className="status-modal schedule-modal"> {/* Add specific class */}
                <h3 className="status-title">Schedule Physical Interview</h3>
                <p className="status-description schedule-description">
                    Enter the details for the physical interview with <strong>{candidateName}</strong> for the <strong>{jobTitle}</strong> position.
                </p>
                {error && <p className="modal-error">{error}</p>}
                <div className="schedule-form">
                    <div className="form-group">
                        <label htmlFor="interviewDate">Date *</label>
                        <input
                            type="date"
                            id="interviewDate"
                            value={interviewDate}
                            onChange={(e) => setInterviewDate(e.target.value)}
                            min={new Date().toISOString().split("T")[0]} // Prevent past dates
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="interviewTime">Time *</label>
                        <input
                            type="time"
                            id="interviewTime"
                            value={interviewTime}
                            onChange={(e) => setInterviewTime(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="interviewLocation">Location *</label>
                        <input
                            type="text"
                            id="interviewLocation"
                            placeholder="e.g., Office Address, Meeting Room 5"
                            value={interviewLocation}
                            onChange={(e) => setInterviewLocation(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="contactPerson">Contact Person *</label>
                        <input
                            type="text"
                            id="contactPerson"
                            placeholder="e.g., John Doe (HR Manager)"
                            value={contactPerson}
                            onChange={(e) => setContactPerson(e.target.value)}
                        />
                    </div>
                     <div className="form-group">
                        <label htmlFor="additionalInfo">Additional Information (Optional)</label>
                        <textarea
                            id="additionalInfo"
                            rows="3"
                            placeholder="e.g., Bring your portfolio, Ask for Jane at reception"
                            value={additionalInfo}
                            onChange={(e) => setAdditionalInfo(e.target.value)}
                        />
                    </div>
                </div>
                <div className="status-buttons schedule-buttons">
                    <button className="status-button secondary-button" onClick={handleClose}>
                        Cancel
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirm}>
                        Confirm & Send Email
                    </button>
                </div>
            </div>
        </div>
    );
};

const InterviewResponses = () => {
    const { jobId, candidateId } = useParams();
    const navigate = useNavigate();

    const [responses, setResponses] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [generatingFeedback, setGeneratingFeedback] = useState(false);
    const [candidate, setCandidate] = useState(null);
    const [job, setJob] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [applicationId, setApplicationId] = useState(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmActionType, setConfirmActionType] = useState('');
    const [processingAction, setProcessingAction] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [modalMessage, setModalMessage] = useState('');
    const [expandedQuestions, setExpandedQuestions] = useState({});
    const [playbackTimes, setPlaybackTimes] = useState({});
    const [overallExplanations, setOverallExplanations] = useState({});
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showPiiDetails, setShowPiiDetails] = useState({});


    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);

                const candidateRes = await fetch(`http://localhost:8000/api/candidates/candidate/${candidateId}`);
                if (!candidateRes.ok) throw new Error("Failed to fetch candidate information");
                const candidateData = await candidateRes.json();
                setCandidate(candidateData);

                const jobRes = await fetch(`http://localhost:8000/api/jobs/${jobId}`);
                if (!jobRes.ok) throw new Error("Failed to fetch job information");
                const jobData = await jobRes.json();
                setJob(jobData);

                const applicationsRes = await fetch(`http://localhost:8000/api/candidates/applicants?jobId=${jobId}`);
                if (!applicationsRes.ok) throw new Error("Failed to fetch applications");
                const applications = await applicationsRes.json();

                const application = applications.find(app => app.candidateId === candidateId);
                if (!application) throw new Error("Application not found");
                setApplicationId(application.applicationId);

                const responsesRes = await fetch(`http://localhost:8000/api/interviews/responses/${application.applicationId}`);
                if (!responsesRes.ok) {
                    if (responsesRes.status === 404) {
                        setResponses(null);
                        setError("No interview responses found for this candidate");
                        setLoading(false);
                        return;
                    }
                    throw new Error(`Failed to fetch interview responses: ${responsesRes.statusText}`);
                }

                const responsesData = await responsesRes.json();
                setResponses(responsesData);
                setError(null);

                setOverallExplanations(responsesData.analysis?.explanation || {});

                // Fetch questions
                const questionsRes = await fetch(`http://localhost:8000/api/interview-questions/actual-questions/${application.applicationId}`);
                if (questionsRes.ok) {
                    const questionsData = await questionsRes.json();
                    setQuestions(questionsData.questions || []);
                } else {
                    console.warn("Could not fetch actual interview questions text.");
                    setQuestions([]); // Ensure questions is an array
                }


                if (responsesData && responsesData.questions && responsesData.questions.length > 0) {
                    const needsFeedback = responsesData.questions.some(q => !q.AIFeedback);
                    // Check if AI feedback generation is needed
                    if (needsFeedback) {
                         setGeneratingFeedback(true);
                         // Pass job and candidate data to feedback generation
                         await generateAIFeedback(responsesData, application.applicationId, jobData, candidateData);
                    }
                }

                setLoading(false);
            } catch (error) {
                setError(error.message || "An error occurred while fetching data");
                setLoading(false);
            }
        };

        fetchData();
    }, [jobId, candidateId]);

    useEffect(() => {
        if (responses && responses.questions && responses.questions.length > 0) {
            const initialExpandedState = {};
            responses.questions.forEach((_, index) => {
                initialExpandedState[index] = true;
            });
            setExpandedQuestions(initialExpandedState);
        }
    }, [responses]);

    const toggleQuestionExpansion = (index) => {
        setExpandedQuestions(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    const generateAIFeedback = async (responsesData, appId, jobData, candidateData) => {
         setGeneratingFeedback(true); // Ensure banner shows
        try {
            const responsesNeedingFeedback = responsesData.questions
                // Use originalTranscript for feedback generation, ensure it's valid
                .filter(q => !q.AIFeedback && q.originalTranscript && q.originalTranscript.trim() && q.originalTranscript !== "Processing...")
                .map(q => ({
                    questionId: q.questionId,
                    responseId: q.responseId,
                    transcript: q.originalTranscript // Send originalTranscript to backend
                }));

            if (responsesNeedingFeedback.length === 0) {
                setGeneratingFeedback(false);
                return;
            }

            const questionsWithText = responsesNeedingFeedback.map(response => {
                 const questionText = getQuestionText(response.questionId); // Use existing function
                 return {
                    ...response,
                    questionText // This refers to the question text itself, not the answer transcript
                 };
            });

            const feedbackRes = await fetch('http://localhost:8000/api/interviews/generate-feedback', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    applicationId: appId,
                    responses: questionsWithText, // Contains originalTranscript as 'transcript'
                    jobTitle: jobData?.jobTitle || 'Unknown position',
                    jobId: jobData?.jobId,
                    candidateId: candidateData?.candidateId
                })
            });

            if (!feedbackRes.ok) {
                 const errorData = await feedbackRes.text();
                 console.error("Feedback generation failed:", errorData);
                throw new Error(`Failed to generate AI feedback: ${feedbackRes.statusText}`);
            }

            const feedbackData = await feedbackRes.json();

            // Update local state immediately
            const updatedResponses = {
                ...responsesData,
                questions: responsesData.questions.map(q => {
                    const feedback = feedbackData.feedback.find(f => f.responseId === q.responseId);
                    if (feedback) {
                        return { ...q, AIFeedback: feedback.feedback };
                    }
                    return q;
                })
            };
             setResponses(updatedResponses);

            await fetch(`http://localhost:8000/api/interviews/update-responses/${appId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(updatedResponses)
            });

        } catch (error) {
            console.error("Error during AI feedback generation process:", error);
        } finally {
            setGeneratingFeedback(false);
        }
    };

    const handleSendEmail = (type) => {
        setConfirmActionType(type);
        setShowConfirmModal(true);
    };

    const handleConfirmAction = async () => {
        setShowConfirmModal(false);
        setProcessingAction(true);

        try {
            const endpoint = confirmActionType === 'approve'
                ? 'http://localhost:8000/api/interviews/send-offer'
                : 'http://localhost:8000/api/interviews/send-rejection';

            const email = candidate?.extractedText?.applicant_mail || '';

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    applicationId,
                    candidateId,
                    jobId,
                    email,
                    candidateName: candidate?.extractedText?.applicant_name || 'Candidate',
                    jobTitle: job?.jobTitle || 'the position'
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to send ${confirmActionType === 'approve' ? 'offer' : 'rejection'} email`);
            }

            setModalMessage(
                confirmActionType === 'approve'
                    ? 'Job offer email has been sent successfully!'
                    : 'Rejection email has been sent successfully!'
            );
            setShowSuccessModal(true);

            const newStatus = confirmActionType === 'approve' ? 'approved' : 'rejected';
            await fetch(`http://localhost:8000/api/candidates/update-status/${applicationId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status: newStatus })
            });

        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
            setShowSuccessModal(true);
        } finally {
            setProcessingAction(false);
        }
    };

    const handleCancelAction = () => {
        setShowConfirmModal(false);
    };

    const getQuestionText = (questionId) => {
        if (!questions || questions.length === 0) return 'Question text unavailable';
        const question = questions.find(q => q.questionId === questionId);
        return question ? question.text : `Question (ID: ${questionId})`; // Provide ID if text missing
    };

    const handleAudioTimeUpdate = (responseId, time) => {
        setPlaybackTimes(prev => ({
            ...prev,
            [responseId]: time
        }));
    };

    const handleBackToCandidateProfile = () => {
        setLoading(true);
        navigate(`/dashboard/${jobId}/${candidateId}`, {
            state: {
                directToJobDetails: true,
                jobId: jobId
            }
        });
    };

    const handleBackToJobDetails = () => {
        setLoading(true);
        navigate(`/dashboard`, {
            state: {
                directToJobDetails: true,
                jobId: jobId,
                skipJobList: true
            },
            replace: true
        });
    };

    const handleSchedulePhysicalInterviewClick = () => {
        setShowScheduleModal(true);
    };

    // *** NEW Handler for confirming schedule and sending email ***
    const handleConfirmSchedule = async (details) => {
        setShowScheduleModal(false);
        setProcessingAction(true);
        setModalMessage(''); // Clear previous messages

        try {
            const endpoint = 'http://localhost:8000/api/interviews/schedule-physical'; // Define your new endpoint
            const email = candidate?.extractedText?.applicant_mail || '';
            if (!email) {
                throw new Error("Candidate email not found.");
            }
            if (!applicationId) {
                 throw new Error("Application ID not found.");
            }


            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    applicationId,
                    candidateId,
                    jobId,
                    email,
                    candidateName: candidate?.extractedText?.applicant_name || 'Candidate',
                    jobTitle: job?.jobTitle || 'the position',
                    interviewDate: details.date,
                    interviewTime: details.time,
                    interviewLocation: details.location,
                    contactPerson: details.contact,
                    additionalInfo: details.additionalInfo // Send optional info
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Failed to schedule physical interview (${response.status})`);
            }

            setModalMessage('Physical interview scheduled and email sent successfully!');
            setShowSuccessModal(true);

            // Optionally update application status locally or refetch
            // Example: Update status to 'Physical Interview Scheduled'
            // await fetch(`http://localhost:8000/api/candidates/update-status/${applicationId}`, { ... body: { status: 'physical interview scheduled' } ... });

        } catch (error) {
            console.error("Error scheduling physical interview:", error);
            setModalMessage(`Error: ${error.message}`);
            setShowSuccessModal(true); // Show error in the success modal for simplicity
        } finally {
            setProcessingAction(false);
        }
    };

    const SuccessModal = () => (
        <div className="status-modal-overlay">
            <div className="status-modal">
                <div className={`status-icon ${modalMessage.includes('Error') ? 'error-icon' : 'success-icon'}`}>
                    {modalMessage.includes('Error') ? (
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                    ) : (
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    )}
                </div>
                <h3 className="status-title">{modalMessage.includes('Error') ? 'Error' : 'Success'}</h3>
                <p className="status-description">{modalMessage}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowSuccessModal(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

    const ConfirmModal = () => (
        <div className="status-modal-overlay">
            <div className="status-modal">
                <div className="status-icon warning-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h3 className="status-title">Confirm Action</h3>
                <p className="status-description">
                    {confirmActionType === 'approve'
                        ? 'Are you sure you want to send a job offer email to this candidate?'
                        : 'Are you sure you want to send a rejection email to this candidate?'}
                </p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={handleCancelAction}>
                        Cancel
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirmAction}>
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );

    if (loading || processingAction) {
        return (
            <div className="dashboard-container" style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '80vh',
                backgroundColor: 'rgb(255, 255, 255)'
            }}>
                <div className="loading-indicator" style={{ textAlign: 'center' }}>
                    <LoadingAnimation />
                    <p style={{ marginTop: '20px' }}>
                        {processingAction ? 'Processing your request...' : 'Loading interview responses...'}
                    </p>
                </div>
            </div>
        );
    }

    if (error && !responses) {
        return (
            <div className="interview-responses-container">
                <div className="error-container">
                    <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                    <h2>Error</h2>
                    <p>{error}</p>
                    <button className="back-button" onClick={() => navigate(`/dashboard/${jobId}/${candidateId}`)}>
                        Return to Candidate Profile
                    </button>
                </div>
            </div>
        );
    }

    return (
        <AudioPlayerProvider>
            <div className="interview-responses-container">
                {/* Modals */}
                {showSuccessModal && <SuccessModal />}
                {showConfirmModal && <ConfirmModal />}

                {/* Render Schedule Modal */}
                <SchedulePhysicalInterviewModal
                    isOpen={showScheduleModal}
                    onClose={() => setShowScheduleModal(false)}
                    onConfirm={handleConfirmSchedule}
                    jobTitle={job?.jobTitle || 'the position'}
                    candidateName={candidate?.extractedText?.applicant_name || 'Candidate'}
                />

                {/* Back Button */}
                <button className="back-button" onClick={handleBackToJobDetails}>
                    <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
                    </svg>
                    Back to Job Details
                </button>

                {/* Header */}
                <div className="responses-header">
                    <h1>Interview Responses</h1>
                    <div className="candidate-info">
                        <span className="candidate-id">Candidate ID: {candidateId}</span>
                        {job && <span className="job-title">Position: {job.jobTitle}</span>}
                    </div>
                </div>

                {/* Overall Performance Analysis (includes overall XAI toggle) */}
                {responses && responses.analysis && (
                    <PerformanceAnalysis
                        analysis={responses.analysis}
                        explanations={overallExplanations} // Pass overall explanations if available at top level
                    />
                )}

                {/* AI Feedback Generation Banner */}
                {generatingFeedback && (
                    <div className="generating-feedback-banner">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="17 8 12 3 7 8"></polyline>
                            <line x1="12" y1="3" x2="12" y2="15"></line>
                        </svg>
                        <span>Generating AI feedback on responses...</span>
                    </div>
                )}

                {/* List of Question Responses */}
                 <div className="response-list">
                    {responses && responses.questions && responses.questions.length > 0 ? (
                        responses.questions.map((response, index) => {
                            // --- START: Transcript Selection Logic ---
                            let transcriptToDisplay = "Transcript not available.";
                            let isDisplayingCensored = false;
                            // let isDisplayingOriginal = false; // Not directly used for badges, but good for internal logic
                            let isCensorshipStillProcessing = false; // For the (Text censorship processing...) badge

                            if (response.censoredTranscript) { // If censoredTranscript field exists in DB
                                transcriptToDisplay = response.censoredTranscript;
                                isDisplayingCensored = true;
                                if (response.censoredTranscript === "Processing...") {
                                    isCensorshipStillProcessing = true;
                                }
                                // If censoredTranscript is an error message like "Censorship failed", it will be displayed.
                            } else if (response.originalTranscript) { // Fallback to original if censoredTranscript field is missing
                                transcriptToDisplay = response.originalTranscript;
                                // isDisplayingOriginal = true;
                                // If original is shown because censoredTranscript field is missing,
                                // and PII was detected but not yet processed, indicate processing.
                                if (response.transcriptBiasAnalysis?.detectedSegments?.length > 0 && !response.transcriptBiasAnalysis?.processedAt) {
                                    isCensorshipStillProcessing = true;
                                }
                            } else if (response.transcript) { // Fallback to old 'transcript' field if others are missing
                                transcriptToDisplay = response.transcript;
                                // isDisplayingOriginal = true; // Treat old 'transcript' field as original
                                if (response.transcriptBiasAnalysis?.detectedSegments?.length > 0 && !response.transcriptBiasAnalysis?.processedAt) {
                                    isCensorshipStillProcessing = true;
                                }
                            }

                            // Determine if the displayed text represents a successfully censored version
                            const showCensoredCompleteIndicator = isDisplayingCensored &&
                                                          transcriptToDisplay !== "Processing..." &&
                                                          transcriptToDisplay !== response.originalTranscript && // Ensure it's different
                                                          response.transcriptBiasAnalysis?.detectedSegments?.length > 0;
                            // --- END: Transcript Selection Logic ---

                            let transcriptForSyncComponent = response.originalTranscript || response.transcript || "";
                            if (transcriptForSyncComponent === "Processing...") {
                                // If the original is still processing, pass that along
                            } else if (!transcriptForSyncComponent && response.censoredTranscript && response.censoredTranscript !== "Processing...") {
                                // Edge case: if only censored is available and it's not "Processing...",
                                // but we don't have original for wordTimings, sync will be imperfect.
                                // For now, we prioritize original for sync. If it's truly missing, sync won't work well.
                                // This scenario implies data inconsistency.
                                // console.warn("Word timings might not match displayed censored transcript if original is missing.");
                                // transcriptForSyncComponent = response.censoredTranscript; // Or decide to show error/static
                            }


                            let transcriptSectionBadgeText = "";
                            const piiDetected = response.transcriptBiasAnalysis?.detectedSegments?.length > 0;
                            const censoredReady = response.censoredTranscript &&
                                                  response.censoredTranscript !== "Processing..." &&
                                                  response.censoredTranscript !== response.originalTranscript;

                            if (piiDetected) {
                                if (censoredReady) {
                                    transcriptSectionBadgeText = "(PII/Bias Censored)";
                                } else if (response.censoredTranscript === "Processing..." || (!response.censoredTranscript && response.originalTranscript && response.originalTranscript !== "Processing...")) {
                                    // If censored is processing, OR if censored field doesn't exist yet but original does (implying censorship might be pending)
                                    transcriptSectionBadgeText = "(Text censorship processing...)";
                                } else if (response.transcriptBiasAnalysis?.audioCensorshipFailed && !censoredReady) {
                                     // If audio censorship failed and text censorship also didn't produce a distinct censoredTranscript
                                     transcriptSectionBadgeText = "(Text censorship may be incomplete)";
                                }
                            }

                            let audioUrlToPlay = response.censoredAudioUrl; // Prioritize censored audio
                            let audioTypeLabel = "";
                            let audioDownloadLink = null;
                            let audioDownloadLabel = "";

                            if (audioUrlToPlay) {
                                audioTypeLabel = "(Playing censored audio with bleeps)";
                                audioDownloadLink = response.censoredAudioUrl;
                                audioDownloadLabel = "Censored Audio";
                            } else {
                                audioUrlToPlay = response.pitchShiftedAudioUrl; // Fallback to pitch-shifted (anonymized voice)
                                if (audioUrlToPlay) {
                                    audioTypeLabel = "(Playing pitch-shifted audio)";
                                    audioDownloadLink = response.pitchShiftedAudioUrl;
                                    audioDownloadLabel = "Pitch-Shifted Audio";
                                }
                                // OriginalAudioUrl is not used for playback, only for potential admin download if implemented
                            }

                            const hasPiiSegmentsInText = response.transcriptBiasAnalysis?.detectedSegments?.length > 0;
                            // Audio censorship is pending if PII was found in text, an original audio exists, but no censored audio URL yet.
                            const isAudioCensorshipProcessing = hasPiiSegmentsInText && response.originalAudioUrl && !response.censoredAudioUrl && !response.transcriptBiasAnalysis?.audioCensorshipFailed;
                            const audioCensorshipFailed = hasPiiSegmentsInText && response.originalAudioUrl && !response.censoredAudioUrl && response.transcriptBiasAnalysis?.audioCensorshipFailed;

                            return(
                            <div
                                key={response.responseId || index}
                                className={`response-card ${expandedQuestions[index] ? 'expanded' : 'collapsed'}`}
                            >
                                {/* --- Clickable Question Header --- */}
                                <div
                                    className="question-header"
                                    onClick={() => toggleQuestionExpansion(index)}
                                >
                                    <div className="question-header-content">
                                        <div className="question-identifier">
                                            <span className="question-number">Q{index + 1}</span>
                                        </div>
                                        <h3 className="question-text">
                                            {getQuestionText(response.questionId)}
                                        </h3>
                                        {/* General Content Warning from NLP API */}
                                        {response.nlpBiasCheck?.flagged && (
                                            <span className="content-warning" title={`NLP Content Warning: ${response.nlpBiasCheck.details?.join(', ') || 'Details unavailable'}`}>
                                                Content Warning
                                            </span>
                                        )}
                                        {hasPiiSegmentsInText && (
                                            <span className="content-warning" title="PII/Bias detected in text by AI" style={{marginLeft: 10, backgroundColor: '#fae1de', color: '#ff8375', borderColor: '#ff4a36'}}>
                                                PII/Bias Flagged
                                            </span>
                                        )}
                                        <div className="toggle-indicator">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: expandedQuestions[index] ? 'rotate(180deg)' : 'none' }}>
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                <div className="question-content">

                                    {typeof response.wordCount === 'number' && response.wordCount >= 0 && (
                                        <div className="response-length-info">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '5px', color: '#64748b' }}>
                                                <path d="M17 6.1H3M17 12.1H3M11 18.1H3M21 6v12l-4-6z"></path>
                                            </svg>
                                            Response length: {response.wordCount} words
                                        </div>
                                    )}

                                    {audioUrlToPlay ? (
                                        <div className="response-section audio-section">
                                            <AudioPlayer
                                                audioUrl={audioUrlToPlay}
                                                transcript={transcriptToDisplay}
                                                wordTimings={response.wordTimings}
                                                onTimeUpdate={(time) => handleAudioTimeUpdate(response.responseId, time)}
                                                playerId={`${response.responseId}-audio`}
                                            />
                                            <div className="audio-download-link">
                                                {audioTypeLabel && <span style={{fontSize: '0.8em', color: audioTypeLabel.includes('censored') ? 'green' : 'blue', fontWeight:'bold', marginRight: 'auto'}}>{audioTypeLabel}</span>}
                                                {isAudioCensorshipProcessing && <span style={{fontSize: '0.8em', color: 'orange', marginLeft: '5px'}}>(Audio bleeping processing...)</span>}
                                                {audioCensorshipFailed && <span style={{fontSize: '0.8em', color: 'red', marginLeft: '5px'}}>(Audio bleeping failed)</span>}

                                                <span style={{marginLeft: 'auto'}}>Download:</span>
                                                {audioDownloadLink && (
                                                    <>
                                                        <a href={audioDownloadLink} download target="_blank" rel="noopener noreferrer" title={`Download ${audioDownloadLabel}`}>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px'}}>
                                                               <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>
                                                            </svg>
                                                            {audioDownloadLabel}
                                                        </a>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="response-section audio-section">
                                             <p style={{textAlign: 'center', color: '#777'}}>No audio available for this response.</p>
                                        </div>
                                    )}

                                    {(response.originalTranscript || response.censoredTranscript || response.transcript) && (
                                        <div className="response-section transcript-section">
                                            <h4 className="section-title">
                                                <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
                                                    <path d="M19,3H5C3.9,3,3,3.9,3,5v14c0,1.1,0.9,2,2,2h14c1.1,0,2-0.9,2-2V5C21,3.9,20.1,3,19,3z M10,17H7v-2h3V17z M10,13H7v-2h3V13z M10,9H7V7h3V9z M17,17h-5v-2h5V17z M17,13h-5v-2h5V13z M17,9h-5V7h5V9z"/>
                                                </svg>
                                                Transcript:
                                                {transcriptSectionBadgeText && (
                                                    <span style={{
                                                        fontSize: '0.8em',
                                                        color: transcriptSectionBadgeText.includes('processing') ? '#f57c00' :
                                                               (transcriptSectionBadgeText.includes('incomplete') ? '#ef4444' : '#4caf50'),
                                                        marginLeft: '10px'
                                                    }}>
                                                        {transcriptSectionBadgeText}
                                                    </span>
                                                )}
                                            </h4>
                                            <SynchronizedTranscript
                                                transcript={transcriptForSyncComponent} // Pass the original transcript
                                                wordTimings={response.wordTimings || []}
                                                currentTime={playbackTimes[response.responseId] || 0}
                                                detectedSegments={response.transcriptBiasAnalysis?.detectedSegments || []} // Pass PII segments
                                            />
                                        </div>
                                    )}

                                    {/* --- Display PII/Bias Segments Detected by Gemini (for HR Review) --- */}
                                    {hasPiiSegmentsInText && (
                                        <div className="response-section pii-details-section">
                                            <h5 className="section-title sub-title warning-title" style={{color: '#b91c1c'}}>
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px'}}>
                                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>
                                                </svg>
                                                AI Detected PII/Bias in Text:
                                            </h5>
                                            <div className="pii-details-content">
                                                <ul>
                                                    {response.transcriptBiasAnalysis.detectedSegments.map((seg, i) => (
                                                        <li key={i}><strong>{seg.type}:</strong> [Content Censored]</li>
                                                    ))}
                                                </ul>
                                                <p>
                                                    <i>
                                                        The specific text segments identified as PII/Bias have been replaced with '{response.transcriptBiasAnalysis?.censorChar || '#'}'
                                                        in the displayed transcript. Corresponding audio sections may be bleeped if censored audio is available.
                                                    </i>
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <FacialInterpretation interpretation={response.facial_analysis_interpretation} />

                                     <div className="response-section feedback-section">
                                        <h4 className="section-title">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px'}}>
                                                <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/><path d="m15 5 3 3"/>
                                            </svg>
                                            AI Feedback
                                        </h4>
                                        <div className="feedback-content">
                                            {response.AIFeedback ? (
                                                <div dangerouslySetInnerHTML={{ __html: response.AIFeedback }} />
                                            ) : (
                                                <div className="feedback-loading">
                                                    <p style={{ margin: 0 }}>{generatingFeedback ? 'Generating feedback...' : 'Feedback not available.'}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                     {response.scoring_explanation && Object.keys(response.scoring_explanation).length > 0 && Object.values(response.scoring_explanation).some(arr => arr && arr.length > 0) && (
                                        <div className="response-section individual-xai-section">
                                            <h5 className="section-title sub-title">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px'}}>
                                                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                                                </svg>
                                                Scoring Details for this Question:
                                            </h5>
                                            <div className="xai-details-container">
                                                <XAIExplanation explanationData={response.scoring_explanation} metricName="relevance" />
                                                <XAIExplanation explanationData={response.scoring_explanation} metricName="confidence" />
                                                <XAIExplanation explanationData={response.scoring_explanation} metricName="clarity" />
                                                <XAIExplanation explanationData={response.scoring_explanation} metricName="engagement" />
                                                {response.scoring_explanation?.substance && response.scoring_explanation.substance.length > 0 && (
                                                    <div className="xai-explanation gemini-reasoning">
                                                        <h4>Explanation for Substance:</h4>
                                                        <p>{response.scoring_explanation.substance[0]}</p>
                                                    </div>
                                                )}
                                                {response.scoring_explanation?.job_fit && response.scoring_explanation.job_fit.length > 0 && (
                                                    <div className="xai-explanation gemini-reasoning">
                                                    <h4>Explanation for Job Fit:</h4>
                                                    <p>{response.scoring_explanation.job_fit[0]}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {response.nlpBiasCheck?.flagged && (
                                        <div className="response-section bias-details-section">
                                            <h5 className="section-title sub-title warning-title">
                                                NLP Content Warning:
                                            </h5>
                                            <div className="bias-details-content">
                                                {response.nlpBiasCheck.details && response.nlpBiasCheck.details.length > 0 ? (
                                                    <ul>
                                                        {response.nlpBiasCheck.details.map((detail, i) => <li key={i}>{detail}</li>)}
                                                    </ul>
                                                ) : (
                                                    <p>No specific details provided for the NLP content flag.</p>
                                                )}
                                                <p style={{fontSize: '0.8em', marginTop: '10px'}}><i>Note: Automated NLP check detected potentially sensitive content. Manual review recommended.</i></p>
                                            </div>
                                        </div>
                                    )}

                                </div>
                            </div>
                            )
                        })
                    ) : (
                        <div className="no-responses">
                             <p>No individual question responses are available for this candidate.</p>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="action-buttons">
                    <button
                        className="schedule-button"
                        onClick={handleSchedulePhysicalInterviewClick}
                        disabled={!applicationId || !candidate || !job}
                        title={!applicationId || !candidate || !job ? "Cannot schedule without application/candidate/job info" : ""}
                    >
                        Schedule Physical Interview
                    </button>
                    <button
                        className="reject-button"
                        onClick={() => handleSendEmail('reject')}
                    >
                        Send Rejection Email
                    </button>
                    <button
                        className="approve-button"
                        onClick={() => handleSendEmail('approve')}
                    >
                        Send Job Offer Email
                    </button>
                </div>
            </div>
        </AudioPlayerProvider>
    );
}

export default InterviewResponses;
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './Dashboard.css';
import '../pageloading.css'; // Import the loading animation CSS
import './UploadCV.css'; // Corrected the path for UploadCV.css
import UploadMoreCVModal from '../UploadMoreCVModal';
import RankApplicantsModal from '../RankApplicantsModal';
import RankCriteriaModal from '../RankCriteriaModal';
import SkillTagWithLogo from '../SkillTagWithLogo';
import jsPDF from 'jspdf';
import 'chart.js/auto';
import autoTable from 'jspdf-autotable';

// LoadingAnimation component for consistent loading UI across the application
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

// Helper function to format dates consistently throughout the application
const formatDate = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();

    // Convert to 12-hour format with AM/PM
    let hours = date.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} ${ampm}`;
};

// Update helper function to format CGPA for display
const formatCGPA = (cgpa) => {
    if (cgpa === null || cgpa === undefined) return "N/A";
    if (cgpa < 0) return "N/A";  // Handle legacy data that might still use -1
    if (cgpa === 0) return "N/A"; // Treat 0 as "N/A" for display
    return cgpa.toFixed(2);
};

// Add new utility function for description handling
const truncateDescription = (description, maxLength = 250) => {
    if (!description) return "";
    if (description.length <= maxLength) return description;

    // Try to find a good break point near the maxLength
    let breakPoint = description.lastIndexOf(". ", maxLength);
    if (breakPoint === -1 || breakPoint < maxLength * 0.75) {
        breakPoint = maxLength;
    } else {
        breakPoint += 1; // Include the period
    }

    return description.substring(0, breakPoint);
};

export default function Dashboard() {
    const [jobs, setJobs] = useState([]);
    const [selectedJob, setSelectedJob] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedJob, setEditedJob] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [flippedCards, setFlippedCards] = useState({});
    const [error, setError] = useState(null);
    const [applicants, setApplicants] = useState([]);
    const [jobDetailLoading, setJobDetailLoading] = useState(false);  // <-- New state for job details loading
    const [rankDetailLoading, setRankDetailLoading] = useState(false);  // <-- New state for rank details loading   
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [showRankErrorModal, setShowRankErrorModal] = useState(false);
    const [showRankSuccessModal, setShowRankSuccessModal] = useState(false);
    const [showRankCriteriaModal, setShowRankCriteriaModal] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [modalMessage, setModalMessage] = useState("");
    const descriptionTextareaRef = useRef(null); // Add reference for the textarea
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [rankPrompt, setRankPrompt] = useState("");
    const [processedJobId, setProcessedJobId] = useState("");  // <-- New state for processed job ID
    const [filterStatus, setFilterStatus] = useState('all'); // New state for filter dropdown
    const [jobDetailsExpanded, setJobDetailsExpanded] = useState(true); // New state for collapsible section

    // Add state for department and skill editing
    const [departmentInput, setDepartmentInput] = useState("");
    const [departmentSuggestions, setDepartmentSuggestions] = useState([]);
    const [showDepartmentSuggestions, setShowDepartmentSuggestions] = useState(false);

    const [skillInput, setSkillInput] = useState("");
    const [skillSuggestions, setSkillSuggestions] = useState([]);
    const [showSkillSuggestions, setShowSkillSuggestions] = useState(false);

    const [expandedDescriptions, setExpandedDescriptions] = useState({});

    const [expandedSkillSets, setExpandedSkillSets] = useState({});

    // Sample data for suggestions - wrapped in useMemo to avoid recreation on each render
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

    // Add operation-specific message states
    const [jobLoadingMessage, setJobLoadingMessage] = useState("Loading job details...");
    const [rankingMessage, setRankingMessage] = useState("Processing candidates...");
    const [uploadMessage, setUploadMessage] = useState("Processing uploaded CVs...");

    // Add a function to reset all messages
    const resetAllMessages = () => {
        setModalMessage(null);
        setJobLoadingMessage("Loading job details...");
        setRankingMessage("Processing candidates...");
        setUploadMessage("Processing uploaded CVs...");
    };

    // Search functionality
    const [searchTerm, setSearchTerm] = useState('');
    const [searchCategory, setSearchCategory] = useState('jobTitle');

    // Sorting functionality
    const [sortBy, setSortBy] = useState('latest');

    // For toggling the card
    const toggleCardFlip = (candidateId) => {
        setFlippedCards(prev => ({
            ...prev,
            [candidateId]: !prev[candidateId]
        }));
    };

    // Add handler for Create New Job button
    const handleCreateNewJob = () => {
        // Navigate to the UploadCV page which handles job creation
        window.location.href = "/upload-cv";

        // If you're using React Router, you could use navigate instead:
        // navigate("/upload-cv");
    };

    const renderSkillsWithCount = (skills, expanded = false, jobId) => {
        if (!skills || skills.length === 0) {
            // Use SkillTagWithLogo for the "None specified" case too for consistency
            return <SkillTagWithLogo skillName="None specified" />;
        }

        const showAllSkills = expanded || expandedSkillSets[jobId];
        const displaySkills = showAllSkills ? skills : skills.slice(0, 3);

        return (
            <>
                {displaySkills.map((skill, index) => (
                    // Use the new component here
                    <SkillTagWithLogo 
                        key={`${jobId}-skill-${index}-${skill}`} // Make key more unique
                        skillName={skill} 
                    />
                ))}
                {!showAllSkills && skills.length > 3 && (
                    <div
                        className="skills-overflow-indicator"
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSkillsExpansion(jobId);
                        }}
                    >
                        +{skills.length - 3} more
                    </div>
                )}
            </>
        );
    };

    // Add state for Upload CV modal
    const [showUploadCVModal, setShowUploadCVModal] = useState(false);

    // Add state for RankApplicantsModal
    const [showRankApplicantsModal, setShowRankApplicantsModal] = useState(false);

    // Get location to check for state from navigation
    const location = useLocation();
    const navigate = useNavigate();

    // Extract URL parameters
    const queryParams = new URLSearchParams(location.search);
    const urlJobId = queryParams.get('jobId');

    // Check for direct navigation state from AddInterviewQuestions
    const directNavigation = location.state?.directToJobDetails;
    const stateJobId = location.state?.jobId;

    // Combined job ID from either source, with state taking priority
    const targetJobId = stateJobId || urlJobId;

    // On first render, if we have state, clear it from history
    // to prevent issues on page refresh
    useEffect(() => {
        if (location.state?.directToJobDetails) {
            // Replace the current URL without the state to keep the URL clean
            navigate(location.pathname + (targetJobId ? `?jobId=${targetJobId}` : ''),
                { replace: true, state: {} });
        }
    }, []);

    // Add this function to toggle description expansion
    const toggleDescriptionExpansion = (e, jobId) => {
        // Stop event propagation to prevent navigating to job details
        e.stopPropagation();

        // Toggle the expanded state
        const newState = !expandedDescriptions[jobId];

        // Find the parent job card row element
        const jobCardRow = e.target.closest('.job-card-row');
        if (jobCardRow) {
            if (newState) {
                jobCardRow.classList.add('expanded');
            } else {
                jobCardRow.classList.remove('expanded');

                // When collapsing description, also collapse skills
                setExpandedSkillSets(prev => ({
                    ...prev,
                    [jobId]: false
                }));
            }
        }

        setExpandedDescriptions(prev => ({
            ...prev,
            [jobId]: newState
        }));
    };


    const toggleSkillsExpansion = (jobId) => {
        // When expanding skills, also expand description
        setExpandedDescriptions(prev => ({
            ...prev,
            [jobId]: true
        }));

        // Toggle skills expansion state
        setExpandedSkillSets(prev => ({
            ...prev,
            [jobId]: !prev[jobId]
        }));

        // Find the job card element and add expanded class
        const jobCardElement = document.querySelector(`[data-job-id="${jobId}"]`);
        if (jobCardElement) {
            jobCardElement.classList.add('expanded');
        }
    };

    // Fetch jobs when component mounts
    useEffect(() => {
        const fetchJobs = async () => {
            setIsLoading(true);
            try {
                const response = await fetch('http://localhost:8000/api/jobs'); // FIXED: updated to /api/jobs
                if (!response.ok) {
                    throw new Error("Network response was not ok");
                }
                const dbJobs = await response.json();
                setJobs(dbJobs); // Assuming dbJobs is an array of job objects

                // If there's a jobId in URL or state, select that job automatically
                // We use the combined targetJobId here
                if (targetJobId && dbJobs.length > 0) {
                    setJobDetailLoading(true); // Show loading state immediately

                    const jobToSelect = dbJobs.find(job => job.jobId === targetJobId);
                    if (jobToSelect) {
                        // If coming from interview questions page via direct navigation,
                        // let's select the job right away to avoid the glitch
                        if (directNavigation) {
                            setSelectedJob(jobToSelect);
                            setEditedJob(jobToSelect);
                            fetchApplicants(jobToSelect.jobId).then(() => {
                                setJobDetailLoading(false);
                            });
                        } else {
                            // Otherwise use the original delayed approach
                            handleJobSelect(jobToSelect);
                        }
                    } else {
                        setJobDetailLoading(false);
                    }
                }

                setIsLoading(false);
            } catch (err) {
                setError("Failed to fetch jobs. Please try again.");
                setIsLoading(false);
                console.error("Error fetching jobs:", err);
            }
        };
        fetchJobs();
    }, [targetJobId, directNavigation]); // Add dependencies

    // Filter jobs based on search term and category
    const filteredJobs = jobs.filter(job => {
        if (!searchTerm.trim()) return true;

        const term = searchTerm.toLowerCase();

        switch (searchCategory) {
            case 'jobTitle':
                return job.jobTitle.toLowerCase().includes(term);
            case 'department':
                return job.departments.some(dept => dept.toLowerCase().includes(term));
            case 'requiredSkills':
                return job.requiredSkills && job.requiredSkills.some(skill => skill.toLowerCase().includes(term));
            default:
                return true;
        }
    });

    const filteredApplicants = useMemo(() => {
        if (filterStatus === 'all') {
            return applicants;
        }
        return applicants.filter(applicant => {
            const status = (applicant.status || '').toLowerCase();
            switch (filterStatus) {
                case 'approved':
                    return status === 'approved';
                case 'interview-completed':
                    return status === 'interview completed';
                case 'interview-scheduled':
                    return status === 'interview scheduled';
                case 'physical-interview-scheduled':
                    return status === 'physical interview scheduled';
                case 'interview-abandoned':
                    return status === 'interview abandoned';
                case 'accepted':
                    return status === 'accepted';
                case 'new':
                    return status === 'new' || !status;
                case 'rejected':
                    return status === 'rejected';
                default:
                    return true;
            }
        });
    }, [applicants, filterStatus]);

    // Sort filtered jobs based on sortBy value
    const sortedJobs = [...filteredJobs].sort((a, b) => {
        switch (sortBy) {
            case 'most-applications':
                return b.applicationCount - a.applicationCount;
            case 'latest':
                return new Date(b.createdAt) - new Date(a.createdAt);
            case 'oldest':
                return new Date(a.createdAt) - new Date(b.createdAt);
            case 'a-z':
                return a.jobTitle.localeCompare(b.jobTitle);
            case 'z-a':
                return b.jobTitle.localeCompare(a.jobTitle);
            default:
                return 0;
        }
    });

    const handleSortChange = (e) => {
        setSortBy(e.target.value);
    };

    // Fetch applicants for a selected job from the backend API
    const fetchApplicants = async (jobId) => {
        try {
            // Fix the API endpoint to match the backend API structure
            const response = await fetch(`http://localhost:8000/api/candidates/applicants?jobId=${jobId}`);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            const applicantsData = await response.json();

            // Create two arrays: applicants with scores and those without
            const applicantsWithScores = applicantsData.filter(
                applicant => applicant.rank_score && typeof applicant.rank_score.final_score === 'number'
            );
            const applicantsWithoutScores = applicantsData.filter(
                applicant => !applicant.rank_score || typeof applicant.rank_score.final_score !== 'number'
            );

            // Sort applicants with scores in descending order
            const sortedApplicantsWithScores = [...applicantsWithScores].sort(
                (a, b) => b.rank_score.final_score - a.rank_score.final_score
            );

            // Merge the sorted applicants with the unsorted ones
            const mergedApplicants = [...sortedApplicantsWithScores, ...applicantsWithoutScores];

            setApplicants(mergedApplicants); // Update state for UI reactivity
            return mergedApplicants;         // <<<< RETURN THE FRESHLY FETCHED AND PROCESSED APPLICANTS
        } catch (err) {
            console.error("Error fetching applicants:", err);
            setApplicants([]);  // Set empty array on error to prevent undefined issues
            return [];          // <<<< RETURN EMPTY ARRAY ON ERROR
        }
    };

    const fetchUnscoredApplicants = async (jobId) => {
        try {
            // Fix the API endpoint to match the backend API structure
            const response = await fetch(`http://localhost:8000/api/candidates/applicants?jobId=${jobId}`);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            const applicantsData = await response.json();

            const applicantsWithoutScores = applicantsData.filter(
                applicant => !applicant.rank_score || typeof applicant.rank_score.final_score !== 'number'
            );

            return applicantsWithoutScores;
        } catch (err) {
            console.error("Error fetching applicants:", err);
            setApplicants([]);  // Set empty array on error to prevent undefined issues
        }
    };

    // Fetch applicants for a selected job from the backend API
    const fetchJob = async (jobId) => {
        try {
            // Fetch the latest job data to ensure we have the most up-to-date information
            const jobResponse = await fetch(`http://localhost:8000/api/jobs/${jobId}`);
            if (!jobResponse.ok) {
                throw new Error(`Failed to fetch updated job data: ${jobResponse.status}`);
            }
            const updatedJobData = await jobResponse.json();
            console.log("Fetched updated job data:", updatedJobData);

            // Update the selectedJob and editedJob with the latest data from backend
            setSelectedJob(updatedJobData);
            setEditedJob(updatedJobData);

            // Update the job in the jobs array as well
            setJobs(prevJobs => prevJobs.map(job =>
                job.jobId === updatedJobData.jobId ? updatedJobData : job
            ));
            return updatedJobData; // <<<< RETURN THE FRESHLY FETCHED JOB DATA
        } catch (err) {
            console.error("Error fetching job data:", err);
            // Optionally, update state to reflect error or return null
            setSelectedJob(null); // Or keep existing if preferred
            setEditedJob({});
            return null; // <<<< RETURN NULL OR THROW ERROR
        }
    };

    const scoreApplicants = async (unscoredApplicants) => {
        try {
            // Rank new applicants based on the existing prompt
            const response = await fetch(`http://localhost:8000/api/candidates/rank`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: selectedJob.prompt,
                    applicants: unscoredApplicants,
                    job_document: selectedJob
                })
            });

            // Handle potential network or server errors
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                throw new Error(errorData.detail || `Ranking request failed: ${response.statusText}`);
            }

            // Parse applicant results
            const scoredApplicants = await response.json();

            return scoredApplicants;

        } catch (err) {
            console.error("Error fetching job data:", err);
        }
    };

    // Modify handleJobSelect to add loading effect
    const handleJobSelect = (job) => {
        resetAllMessages(); // Reset all messages first
        setJobDetailLoading(true);
        setJobLoadingMessage("Loading job details..."); // Set specific message

        setTimeout(() => {
            setSelectedJob(job);
            setEditedJob(job);
            fetchApplicants(job.jobId).then(() => {
                setJobDetailLoading(false);
            });
        }, 300);
    };

    // Inside Dashboard component, add click handler for descriptions
    const handleDescriptionClick = (jobId) => {
        handleJobSelect(jobs.find(job => job.jobId === jobId));
    };

    // Modify handleBackToJobs to add a loading effect when clicking "Back to Jobs"
    const handleBackToJobs = () => {
        resetAllMessages();
        setJobDetailLoading(true);
        setJobLoadingMessage("Returning to job list...");

        setTimeout(() => {
            setSelectedJob(null);
            setIsEditing(false);
            setApplicants([]);
            setJobDetailLoading(false);
            setFlippedCards({});
        }, 300);
    };

    // Modify handleEditToggle to ensure job details are expanded when editing
    const handleEditToggle = () => {
        // If we're starting to edit
        if (!isEditing) {
            // Reset the state to the current job data
            setEditedJob(selectedJob);

            // Clear any pending input in department and skill fields
            setDepartmentInput("");
            setSkillInput("");

            // Ensure job details section is expanded when editing starts
            setJobDetailsExpanded(true);

            // Schedule the textarea resize after render
            setTimeout(() => {
                adjustTextareaHeight();
            }, 0);
        }

        setIsEditing(!isEditing);
    };

    // Function to adjust textarea height based on content
    const adjustTextareaHeight = () => {
        if (descriptionTextareaRef.current) {
            descriptionTextareaRef.current.style.height = 'auto';
            descriptionTextareaRef.current.style.height = `${descriptionTextareaRef.current.scrollHeight}px`;
        }
    };

    // Ensure the handleSaveChanges function properly formats the data before sending
    const handleSaveChanges = async () => {
        try {
            // Ensure minimumCGPA is formatted to 2 decimal places
            let cgpaToSave = editedJob.minimumCGPA;
            if (editedJob.minimumCGPA === "N/A") {
                cgpaToSave = 0; // Save as 0 instead of null for N/A
            }

            const updatedJobData = {
                ...editedJob,
                minimumCGPA: cgpaToSave,
                requiredSkills: editedJob.requiredSkills || []
            };

            console.log("Sending job update:", updatedJobData);

            const response = await fetch(`http://localhost:8000/api/jobs/${updatedJobData.jobId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updatedJobData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ detail: "Unknown error" }));
                throw new Error(errorData.detail || "Failed to update job");
            }

            const updatedJob = await response.json();
            console.log("Received updated job:", updatedJob); // Debug: check what we received back

            setJobs(jobs.map(job => job.jobId === updatedJob.jobId ? updatedJob : job));
            setSelectedJob(updatedJob);
            setIsEditing(false);
            setModalMessage("Your changes have been saved successfully.");
            setShowSuccessModal(true);
        } catch (err) {
            console.error("Error updating job:", err);
            setModalMessage(err.message || "Failed to update job. Please try again.");
            setShowErrorModal(true);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setEditedJob({
            ...editedJob,
            [name]: value
        });

        // Adjust height when job description changes
        if (name === 'jobDescription' && descriptionTextareaRef.current) {
            setTimeout(() => adjustTextareaHeight(), 0);
        }
    };

    const handleSearchChange = (e) => {
        setSearchTerm(e.target.value);
    };

    const handleCategoryChange = (e) => {
        setSearchCategory(e.target.value);
    };

    // Add new handler for "Upload More CV"
    const handleUploadMoreCV = () => {
        setShowUploadCVModal(true);
    };

    // Handle upload complete event
    const handleUploadComplete = async (count) => {
        try {
            // Show the initial success message for the upload itself
            setModalMessage(`${count} resume${count > 1 ? 's' : ''} processed successfully.`);
            setShowSuccessModal(true); // This modal will be short-lived if re-ranking occurs

            if (selectedJob && selectedJob.jobId) {
                const currentJobId = selectedJob.jobId; // Get current job ID before state updates

                setRankDetailLoading(true); // Start loading for re-ranking
                setUploadMessage("Refreshing applicant data and re-ranking...");

                // 1. Fetch updated applicants AND USE THE RETURNED VALUE
                const freshApplicants = await fetchApplicants(currentJobId);
                // 2. Fetch the latest job data AND USE THE RETURNED VALUE
                const freshJobDocument = await fetchJob(currentJobId);


                // 3. Re-rank if a prompt exists
                if (freshJobDocument && freshJobDocument.prompt) { // Use prompt from fresh job data
                    setShowSuccessModal(false); // Close the initial success modal before starting ranking
                    setRankingMessage("Re-ranking candidates after CV update...");

                    const response = await fetch(`http://localhost:8000/api/candidates/rank`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt: freshJobDocument.prompt,      // Use fresh prompt
                            applicants: freshApplicants,          // Use fresh applicants list
                            job_document: freshJobDocument        // Use fresh job document
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                        throw new Error(errorData.detail || `Re-ranking request failed: ${response.statusText}`);
                    }

                    const rankingResults = await response.json();
                    if (!rankingResults || !rankingResults.applicants) {
                        throw new Error("Invalid re-ranking results received");
                    }

                    // Update local applicants state immediately with new scores
                    setApplicants(rankingResults.applicants);

                    // Batch update candidate rankings in Firestore
                    const batchSize = 5;
                    const updateBatch = async (startIdx, endIdx) => {
                        const updatePromises = rankingResults.applicants
                            .slice(startIdx, endIdx)
                            .filter(applicant => applicant.candidateId)
                            .map(applicant =>
                                fetch(`http://localhost:8000/api/candidates/candidate/${applicant.candidateId}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        ...applicant, // Send all applicant data (includes status etc.)
                                        rank_score: applicant.rank_score,
                                        reasoning: applicant.reasoning,
                                        job_id: currentJobId // Ensure job_id is passed for context if needed by backend update
                                    })
                                })
                            );
                        await Promise.all(updatePromises.map(p => p.catch(e => console.error("Batch update error:", e))));
                    };

                    for (let i = 0; i < rankingResults.applicants.length; i += batchSize) {
                        await updateBatch(i, i + batchSize);
                    }

                    // Fetch applicants again to ensure UI consistency after batch updates
                    // and ensure the 'applicants' state is correct for the UI.
                    await fetchApplicants(currentJobId);

                    setModalMessage("CVs processed and candidates re-ranked successfully.");
                    setShowRankSuccessModal(true); // Show the rank success modal
                } else {
                    // No prompt, or freshJobDocument is null, so just refresh the list
                    await fetchApplicants(currentJobId);
                    if (freshJobDocument) {
                        console.info("CVs processed. Applicants list refreshed. No ranking prompt set for re-ranking.");
                    } else {
                        console.warn("CVs processed, but failed to fetch updated job document. Applicants list refreshed.");
                    }
                }

            } else {
                console.error("Cannot refresh applicant list or re-rank: selectedJob or selectedJob.jobId is missing.");
                setModalMessage("Failed to refresh applicant list or re-rank: Job context lost.");
                setShowErrorModal(true);
            }

        } catch (error) {
            setModalMessage(`Failed during post-upload processing: ${error.message}`);
            setShowErrorModal(true);
            console.error("Error during post-upload processing:", error);
        } finally {
            setRankDetailLoading(false); // Stop loading indicator
            resetAllMessages(); // Reset specific loading messages
        }
    };

    // Handle scoring applicants when they are not scored but others are
    const handleUnscoredApplicants = async () => {
        // This function is now handled directly within handleUploadComplete
        // We'll keep it for backward compatibility and other use cases
    };

    // Handle Rank Applicants button click
    const handleRankApplicants = () => {
        // Close any other modals that might be open
        setShowRankCriteriaModal(false);

        // Reset any state that might interfere
        console.log("Opening rank applicants modal for job:", selectedJob?.jobId);

        // Use setTimeout to ensure state updates happen in the correct order
        setTimeout(() => {
            setShowRankApplicantsModal(true);
        }, 0);
    };

    const handleRankInfoClick = (e) => {
        // Prevent the event from bubbling up to parent elements
        e.stopPropagation();

        // Close other modals
        setShowRankApplicantsModal(false);

        // Show the rank criteria modal
        console.log("Opening rank criteria modal");
        setTimeout(() => {
            setShowRankCriteriaModal(true);
        }, 0);
    };

    const handlePromptComplete = async (prompt) => {
        // Close the modal first
        setShowRankApplicantsModal(false);

        try {
            resetAllMessages(); // Reset messages
            setRankDetailLoading(true);
            setRankingMessage("Processing applicant rankings...");

            // Reset any previous error states
            setModalMessage(null);
            setShowRankErrorModal(false);
            setShowRankSuccessModal(false);

            // Fetch applicants and job data to ensure latest information
            await fetchApplicants(selectedJob.jobId);
            await fetchJob(selectedJob.jobId);

            // Validate input
            if (!selectedJob || !prompt) {
                throw new Error("Missing job or ranking prompt");
            }

            // Check if this is a new prompt or a repeat
            // Check if the current prompt's content is significantly different from the previous prompt
            // by checking if the key terms are included, regardless of order
            const hasSignificantPromptChange = () => {
                if (!rankPrompt || !prompt) return true; // If either is empty, consider it a change

                // Convert both prompts to lowercase for case-insensitive comparison
                const currentPromptLower = prompt.toLowerCase();
                const previousPromptLower = rankPrompt.toLowerCase();

                // Create arrays of significant terms from each prompt
                const currentTerms = currentPromptLower.split(/[,\s]+/).filter(term => term.length > 2);
                const previousTerms = previousPromptLower.split(/[,\s]+/).filter(term => term.length > 2);

                // Check if all significant terms from current prompt exist in previous prompt and vice versa
                const allCurrentTermsInPrevious = currentTerms.every(term =>
                    previousTerms.some(prevTerm => prevTerm.includes(term) || term.includes(prevTerm))
                );
                const allPreviousTermsInCurrent = previousTerms.every(prevTerm =>
                    currentTerms.some(currTerm => currTerm.includes(prevTerm) || prevTerm.includes(currTerm))
                );

                // Consider it the same prompt if terms match in both directions
                return !(allCurrentTermsInPrevious && allPreviousTermsInCurrent);
            };

            // Only process if the prompt has significantly changed or we're processing a different job
            if (hasSignificantPromptChange() || selectedJob.jobId !== processedJobId) {
                // Send ranking request to backend
                const response = await fetch(`http://localhost:8000/api/candidates/rank`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        applicants: applicants,
                        job_document: selectedJob
                    })
                });

                // Handle potential network or server errors
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ detail: response.statusText }));
                    throw new Error(errorData.detail || `Ranking request failed: ${response.statusText}`);
                }

                // Parse ranking results
                const rankingResults = await response.json();

                // Validate ranking results
                if (!rankingResults) {
                    throw new Error("Invalid ranking results received");
                }

                // Update job with new prompt
                await fetch(`http://localhost:8000/api/jobs/${selectedJob.jobId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...selectedJob,
                        prompt: prompt
                    })
                });

                // Batch update candidate rankings if available
                if (rankingResults.applicants && rankingResults.applicants.length > 0) {
                    // Update local applicants state immediately to show results
                    setApplicants(rankingResults.applicants);

                    // Process candidate updates in batches
                    const batchSize = 5;
                    const updateBatch = async (startIdx, endIdx) => {
                        const updatePromises = rankingResults.applicants
                            .slice(startIdx, endIdx)
                            .filter(applicant => applicant.candidateId)
                            .map(applicant =>
                                fetch(`http://localhost:8000/api/candidates/candidate/${applicant.candidateId}`, {
                                    method: 'PUT',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                        ...applicant,
                                        rank_score: applicant.rank_score,
                                        reasoning: applicant.reasoning,
                                        job_id: selectedJob.jobId
                                    })
                                })
                            );

                        await Promise.all(updatePromises);
                    };

                    // Process updates in batches
                    for (let i = 0; i < rankingResults.applicants.length; i += batchSize) {
                        await updateBatch(i, i + batchSize);
                    }
                }

                // Store the new ranking prompt
                setRankPrompt(prompt);

                // Store the processed job id
                setProcessedJobId(selectedJob.jobId);

                // Show success message
                setModalMessage("Applicants have been ranked based on your criteria.");
                setShowRankSuccessModal(true);
            } else {
                // Same prompt used again for the same job
                setModalMessage("Using existing ranking based on the same criteria.");
                setShowRankSuccessModal(true);
            }

            // Reload job data to update the UI with new ranking criteria
            await fetchJob(selectedJob.jobId);
            await fetchApplicants(selectedJob.jobId);

        } catch (error) {
            // Centralized error handling
            console.error("Error in ranking applicants:", error);
            setModalMessage(`Failed to rank applicants: ${error.message}`);
            setShowRankErrorModal(true);
        } finally {
            // Ensure loading state is always turned off
            setRankDetailLoading(false);
        }
    };

    const handleExportScores = () => {
        // Close any other modals that might be open
        setShowRankCriteriaModal(false);
        setShowRankApplicantsModal(false);

        // Show export options modal
        setShowExportModal(true);
    };

    const handleMinimumCGPABlur = () => {
        const value = parseFloat(editedJob.minimumCGPA);
        if (!isNaN(value)) {
            setEditedJob({ ...editedJob, minimumCGPA: Number(value.toFixed(2)) });
        }
    };

    const ExportModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon"
                    aria-hidden="true"
                    style={{
                        backgroundColor: "#FEE9E9",
                        width: "80px",
                        height: "80px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#F9645F" viewBox="0 0 16 16">
                        <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                        <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                    </svg>
                </div>
                <h3 className="status-title">Export Candidates Data</h3>
                <p className="status-description">Choose your preferred export format for all candidates:</p>
                <div className="status-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <button
                        className="export-csv-button"
                        style={{ backgroundColor: '#38B2AC' }}
                        onClick={exportCandidatesToCSV}
                    >
                        CSV
                    </button>
                    <button
                        className="export-pdf-button"
                        style={{ backgroundColor: '#485EDB' }}
                        onClick={exportCandidatesToPDF}
                    >
                        PDF
                    </button>
                    <button
                        className="status-button secondary-button"
                        onClick={() => setShowExportModal(false)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );

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
                    {modalMessage && (modalMessage.includes("export") || modalMessage.includes("generated"))
                        ? "File Generated Successfully!"
                        : "Job Updated Successfully!"}
                </h3>
                <p className="status-description">{modalMessage || "Your changes have been saved."}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowSuccessModal(false)}>
                        Close
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
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </div>
                <h3 className="status-title">{"Update Failed!"}</h3>
                <p className="status-description">{modalMessage || "Failed to update job details."}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowErrorModal(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

    const RankSuccessModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal success-modal">
                <div className="status-icon success-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 className="status-title">{"Rank Successful!"}</h3>
                <p className="status-description">{modalMessage || "Applicants have been successfully reranked"}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowRankSuccessModal(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

    const RankErrorModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal error-modal">
                <div className="status-icon error-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="15" y1="9" x2="9" y2="15"></line>
                        <line x1="9" y1="9" x2="15" y2="15"></line>
                    </svg>
                </div>
                <h3 className="status-title">{"Rank Failed!"}</h3>
                <p className="status-description">{modalMessage || "Failed to rank applicants."}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowRankErrorModal(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

    // Create the confirmation modal component
    const ConfirmModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h3 className="status-title">Discard Changes?</h3>
                <p className="status-description">Are you sure you want to discard your unsaved changes?</p>
                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={handleCancelDiscard}>
                        No, Keep Editing
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirmDiscard}>
                        Yes, Discard Changes
                    </button>
                </div>
            </div>
        </div>
    );

    // Function to check if any changes were made to the job
    const hasChanges = () => {
        if (!selectedJob || !editedJob) return false;

        // Check basic fields
        if (selectedJob.jobTitle !== editedJob.jobTitle) return true;
        if (selectedJob.jobDescription !== editedJob.jobDescription) return true;
        if (selectedJob.minimumCGPA !== editedJob.minimumCGPA) return true;

        // Check arrays (departments and skills)
        if (selectedJob.departments.length !== editedJob.departments.length) return true;
        if (selectedJob.requiredSkills.length !== editedJob.requiredSkills.length) return true;

        // Check if departments have changed
        for (let i = 0; i < selectedJob.departments.length; i++) {
            if (!editedJob.departments.includes(selectedJob.departments[i])) return true;
        }

        // Check if required skills have changed
        for (let i = 0; i < selectedJob.requiredSkills.length; i++) {
            if (!editedJob.requiredSkills.includes(selectedJob.requiredSkills[i])) return true;
        }

        return false;
    };

    const handleCancelClick = () => {
        if (hasChanges()) {
            setShowConfirmModal(true);
        } else {
            // No changes, just exit edit mode
            handleCancelEdit();
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedJob(selectedJob); // Reset changes to original job
        setDepartmentInput("");
        setSkillInput("");
    };

    const handleConfirmDiscard = () => {
        setShowConfirmModal(false);
        handleCancelEdit();
    };

    const handleCancelDiscard = () => {
        setShowConfirmModal(false);
        // Stay in edit mode, do nothing
    };

    // Filter suggestions based on input
    useEffect(() => {
        if (departmentInput && isEditing) {
            const filtered = departmentOptions.filter(
                option => option.toLowerCase().includes(departmentInput.toLowerCase())
            );
            setDepartmentSuggestions(filtered);
            setShowDepartmentSuggestions(filtered.length > 0);
        } else {
            setShowDepartmentSuggestions(false);
        }
    }, [departmentInput, departmentOptions, isEditing]);

    useEffect(() => {
        if (skillInput && isEditing) {
            const filtered = skillsOptions.filter(
                option => option.toLowerCase().includes(skillInput.toLowerCase())
            );
            setSkillSuggestions(filtered);
            setShowSkillSuggestions(filtered.length > 0);
        } else {
            setShowSkillSuggestions(false);
        }
    }, [skillInput, skillsOptions, isEditing]);

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (!event.target.closest('.suggestion-container')) {
                setShowDepartmentSuggestions(false);
                setShowSkillSuggestions(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Department handlers
    const handleDepartmentSelect = (department) => {
        if (!editedJob.departments.includes(department)) {
            setEditedJob({
                ...editedJob,
                departments: [...editedJob.departments, department]
            });
        }
        setDepartmentInput("");
        setShowDepartmentSuggestions(false);
    };

    const handleAddDepartment = () => {
        if (departmentInput.trim() && !editedJob.departments.includes(departmentInput.trim())) {
            setEditedJob({
                ...editedJob,
                departments: [...editedJob.departments, departmentInput.trim()]
            });
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
        setEditedJob({
            ...editedJob,
            departments: editedJob.departments.filter(dept => dept !== department)
        });
    };

    // Skill handlers
    const handleSkillSelect = (skill) => {
        if (!editedJob.requiredSkills.includes(skill)) {
            const updatedSkills = [...editedJob.requiredSkills, skill];
            setEditedJob({
                ...editedJob,
                requiredSkills: updatedSkills
            });
        }
        setSkillInput("");
        setShowSkillSuggestions(false);
    };

    const handleAddSkill = () => {
        if (skillInput.trim() && !editedJob.requiredSkills.includes(skillInput.trim())) {
            const updatedSkills = [...editedJob.requiredSkills, skillInput.trim()];
            setEditedJob({
                ...editedJob,
                requiredSkills: updatedSkills
            });
            setSkillInput("");
        }
    };

    const handleSkillKeyPress = (e) => {
        if (e.key === 'Enter' && skillInput.trim()) {
            e.preventDefault();
            handleAddSkill();
        }
    };

    const removeSkill = (skill) => {
        const updatedSkills = editedJob.requiredSkills.filter(s => s !== skill);
        setEditedJob({
            ...editedJob,
            requiredSkills: updatedSkills
        });
        console.log("After removing skill:", editedJob.requiredSkills); // Debug logging
    };

    // Add a new function to handle interview questions navigation
    const handleInterviewQuestionsClick = () => {
        resetAllMessages();
        // Set loading state
        setJobDetailLoading(true);
        setJobLoadingMessage("Loading interview questions...");

        // Use a longer timeout to ensure the loading state and message are fully visible
        // and prevent other operations from changing the message
        setTimeout(() => {
            navigate(`/add-interview-questions?jobId=${selectedJob.jobId}`);
        }, 300);
    };

    // Add function to toggle job details visibility
    const toggleJobDetails = () => {
        setJobDetailsExpanded(!jobDetailsExpanded);
    };

    const exportCandidatesToCSV = async () => {
        setShowExportModal(false);

        if (!selectedJob) {
            setModalMessage("No job selected for export.");
            setShowErrorModal(true);
            return;
        }

        try {
            // Show loading message
            setModalMessage("Preparing CSV export for all candidates...");
            setShowInfoModal(true);

            // Fetch all candidates for the selected job
            await fetchApplicants(selectedJob.jobId);

            const candidates = applicants;

            console.log("Fetched candidates for export:", candidates);

            if (!candidates || candidates.length === 0) {
                setShowInfoModal(false);
                setModalMessage("No candidates data available for export.");
                setShowErrorModal(true);
                return;
            }

            // Define the weights for calculations
            const weights = {
                "skills": {
                    "relevance": 0.50,
                    "proficiency": 0.35,
                    "additionalSkill": 0.15
                },
                "experience": {
                    "jobExp": 0.50,
                    "projectCocurricularExp": 0.30,
                    "certification": 0.20
                },
                "education": {
                    "studyLevel": 0.40,
                    "awards": 0.30,
                    "courseworkResearch": 0.30
                },
                "culturalFit": {
                    "collaborationStyle": 0.40,
                    "growthMindset": 0.30,
                    "communityEngagement": 0.30
                }
            };

            // Get the selected criteria from job prompt
            const selectedCriteria = [];
            if (selectedJob.prompt.includes("Skills")) selectedCriteria.push("skills");
            if (selectedJob.prompt.includes("Experience")) selectedCriteria.push("experience");
            if (selectedJob.prompt.includes("Education")) selectedCriteria.push("education");
            if (selectedJob.prompt.includes("Cultural Fit")) selectedCriteria.push("culturalFit");

            // Map internal keys to display names
            const criteriaDisplayNames = {
                "skills": {
                    "relevance": "Relevance to Job",
                    "proficiency": "Proficiency Level",
                    "additionalSkill": "Additional Skills"
                },
                "experience": {
                    "jobExp": "Job Experience",
                    "projectCocurricularExp": "Projects & Co-curricular",
                    "certification": "Certifications"
                },
                "education": {
                    "studyLevel": "Level of Study",
                    "awards": "Awards & Achievements",
                    "courseworkResearch": "Relevant Coursework"
                },
                "culturalFit": {
                    "collaborationStyle": "Collaboration Style",
                    "growthMindset": "Growth Mindset",
                    "communityEngagement": "Community Engagement"
                }
            };

            // Prepare CSV content
            let csvContent = "data:text/csv;charset=utf-8,";

            // Build the header rows
            let headerRow1 = "Candidates"; // First column header
            let headerRow2 = ""; // Will contain subcriteria
            let headerRow3 = ""; // Will contain raw/weighted labels

            // Build the headers based on selected criteria
            selectedCriteria.forEach(criteria => {
                const subCriteria = Object.keys(weights[criteria]);
                const displayNames = criteriaDisplayNames[criteria];

                // For each subcriteria, add columns for raw and weighted scores
                subCriteria.forEach(sub => {
                    // First row: Major criteria (spanning columns)
                    headerRow1 += "," + criteria.toUpperCase() + ",,";

                    // Second row: Subcriteria names
                    headerRow2 += "," + displayNames[sub] + ",,";

                    // Third row: Raw and Weighted labels
                    headerRow3 += ",Raw,Weighted,";
                });
            });

            // Add the header rows to CSV
            csvContent += headerRow1 + "\n" + headerRow2 + "\n" + headerRow3 + "\n";

            // Add data rows for each candidate
            candidates.forEach(candidate => {
                let row = candidate.candidateId || "Unknown"; // First column is candidate ID

                // For each selected criteria
                selectedCriteria.forEach(criteria => {
                    const subCriteria = Object.keys(weights[criteria]);

                    // For each subcriteria, add raw and weighted scores
                    subCriteria.forEach(sub => {
                        const rawScore = candidate.rank_score?.[sub] || 0;
                        const weightedScore = rawScore * weights[criteria][sub];

                        row += "," + rawScore + "," + weightedScore.toFixed(2) + ",";
                    });
                });

                csvContent += row + "\n";
            });

            // Create download link
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `${selectedJob.jobTitle.replace(/\s+/g, '_')}_candidate_scores.csv`);
            document.body.appendChild(link);

            // Trigger download
            link.click();

            // Clean up
            document.body.removeChild(link);

            setShowInfoModal(false);
            setModalMessage("CSV export completed successfully!");
            setShowSuccessModal(true);

        } catch (error) {
            console.error("Error exporting to CSV:", error);
            setShowInfoModal(false);
            setModalMessage("Failed to export data: " + error.message);
            setShowErrorModal(true);
        }
    };

    // Helper function to convert hex to RGB (ensure it's accessible)
    const hexToRgb = (hex) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 0, g: 0, b: 0 };
    };

    const exportCandidatesToPDF = async () => {
        setShowExportModal(false);

        if (!selectedJob) {
            setModalMessage("No job selected for export.");
            setShowErrorModal(true);
            return;
        }

        try {
            setModalMessage("Preparing PDF report for all candidates...");
            setShowInfoModal(true);

            // Ensure applicants data is fetched and available
            if (!applicants || applicants.length === 0) {
                await fetchApplicants(selectedJob.jobId);
                if (!applicants || applicants.length === 0) {
                    setShowInfoModal(false);
                    setModalMessage("No candidates data available for export.");
                    setShowErrorModal(true);
                    return;
                }
            }
            const candidates = [...applicants]; // Use a copy

            // --- PDF Setup ---
            const pdf = new jsPDF({
                orientation: 'portrait', // Keep portrait
                unit: 'pt',
                format: 'a4',
                compress: true
            });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const pageMargin = 40;
            let currentY = pageMargin; // Global Y tracker, reset on new pages

            const headerHeight = 12; // Header bar height
            const logoStartY = 15;   // Logo Y position
            const logoHeight = 60;   // Logo height
            const headerSpacing = 25; // Additional space below logo
            const contentStartY = logoStartY + logoHeight + headerSpacing;

            const signatureColors = {
                primary: '#F9645F',
                skills: '#8250c8',
                experience: '#dd20c1',
                education: '#0066cc',
                culturalFit: '#ffa000'
            };

            // --- Logo Loading ---
            let logoImg = null;
            try {
                logoImg = new Image();
                logoImg.src = '/equalLensLogoDark.png'; // Path relative to the public folder
                await new Promise((resolve, reject) => {
                    logoImg.onload = resolve;
                    logoImg.onerror = (err) => {
                        console.warn("Could not load logo image:", err);
                        logoImg = null;
                        resolve();
                    };
                    setTimeout(() => {
                        if (!logoImg?.complete) {
                            console.warn("Logo image loading timed out.");
                            logoImg = null;
                            resolve();
                        }
                    }, 3000);
                });
            } catch (err) {
                console.warn("Error initiating logo image loading:", err);
                logoImg = null;
            }

            // --- Header & Footer Function ---
            const addHeaderFooter = (pageNum, options = { drawHeader: true }) => {
                // Footer Bar (Drawn on all pages)
                pdf.setFillColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.rect(0, pageHeight - 12, pageWidth, 12, 'F');

                // Page Number (Only draw on pages > 1)
                if (pageNum > 1) {
                    pdf.setFontSize(10);
                    pdf.setTextColor(80, 80, 80);
                    pdf.text(`Page ${pageNum}`, pageWidth - pageMargin, pageHeight - 20, { align: 'right' });

                    if (options.drawHeader) {
                        // Header Bar (Only draw on pages > 1)
                        pdf.setFillColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                        pdf.rect(0, 0, pageWidth, headerHeight, 'F');

                        // Header Logo (Top Left) (Only draw on pages > 1)
                        if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
                            try {
                                // Adjusted logo size for header
                                pdf.addImage(logoImg, 'PNG', pageMargin, logoStartY, 60, logoHeight);
                            } catch (e) { console.warn("Error adding header logo:", e); }
                        } else {
                            pdf.setFontSize(10);
                            pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                            pdf.text('EqualLens', pageMargin, 25);
                        }
                        // Reset Y below header elements (logo height + margin)
                        currentY = contentStartY;
                    } else {
                        // If not drawing header, reset Y to a suitable top margin for content to start
                        // This ensures content on continued pages (without header) starts near the top.
                        currentY = pageMargin;
                    }
                } else {
                }
            };


            // --- Page 1: Title Page ---
            addHeaderFooter(1); // Adds footer bar and page number for page 1
            currentY = pageHeight * 0.25; // Start content higher up

            pdf.setFontSize(28);
            pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
            pdf.text(`Candidate Assessment Report`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 50;

            pdf.setFontSize(18);
            pdf.setTextColor(60, 60, 60);
            pdf.text(`Position: ${selectedJob.jobTitle || "Unknown Position"}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 30;
            pdf.text(`Department: ${selectedJob.departments?.join(", ") || "N/A"}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 30;
            pdf.text(`Total Candidates: ${candidates.length}`, pageWidth / 2, currentY, { align: 'center' });
            currentY += 30;
            pdf.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth / 2, currentY, { align: 'center' });

            // Footer Logo (Bottom Center for Page 1)
            if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
                try {
                    // Adjusted logo size and position for footer
                    pdf.addImage(logoImg, 'PNG', (pageWidth - 100) / 2, pageHeight - 100, 100, 100);
                } catch (e) { console.warn("Error adding footer logo:", e); }
            } else {
                pdf.setFontSize(12);
                pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.text('EqualLens', pageWidth / 2, pageHeight - 50, { align: 'center' });
            }

            // --- Data Preparation ---
            const weights = {
                "skills": { "relevance": 0.50, "proficiency": 0.35, "additionalSkill": 0.15 },
                "experience": { "jobExp": 0.50, "projectCocurricularExp": 0.30, "certification": 0.20 },
                "education": { "studyLevel": 0.40, "awards": 0.30, "courseworkResearch": 0.30 },
                "culturalFit": { "collaborationStyle": 0.40, "growthMindset": 0.30, "communityEngagement": 0.30 }
            };
            const selectedCriteria = [];
            if (selectedJob.prompt?.includes("Skills")) selectedCriteria.push("skills");
            if (selectedJob.prompt?.includes("Experience")) selectedCriteria.push("experience");
            if (selectedJob.prompt?.includes("Education")) selectedCriteria.push("education");
            if (selectedJob.prompt?.includes("Cultural Fit")) selectedCriteria.push("culturalFit");

            const criteriaDisplayNames = {
                "skills": { "relevance": "Relevance to Job", "proficiency": "Proficiency Level", "additionalSkill": "Additional Skills" },
                "experience": { "jobExp": "Job Experience", "projectCocurricularExp": "Projects & Co-curricular", "certification": "Certifications" },
                "education": { "studyLevel": "Level of Study", "awards": "Awards & Achievements", "courseworkResearch": "Coursework & Research" },
                "culturalFit": { "collaborationStyle": "Collaboration Style", "growthMindset": "Growth Mindset", "communityEngagement": "Community Engagement" }
            };

            // Sort candidates by final score (descending)
            candidates.sort((a, b) => (b.rank_score?.final_score || 0) - (a.rank_score?.final_score || 0));

            // --- Page 2: Skills Comparison Tables (Horizontal) ---
            const allSoftSkills = new Set();
            const allTechSkills = new Set();
            const inferredSoftMap = new Map(); // Map<candidateId, Set<skill>>
            const inferredTechMap = new Map(); // Map<candidateId, Set<skill>>
            const candidateSkillMap = new Map(); // Map<candidateId, {soft: Set, tech: Set, inferredSoft: Set, inferredTech: Set}>

            candidates.forEach(c => {
                const soft = new Set((c.detailed_profile?.soft_skills || []).map(s => s.toUpperCase().replace(/-/g, ' ')));
                const tech = new Set(c.detailed_profile?.technical_skills || []);
                const inferredSoft = new Set((c.detailed_profile?.inferred_soft_skills || []).map(s => s.toUpperCase().replace(/-/g, ' ')));
                const inferredTech = new Set(c.detailed_profile?.inferred_technical_skills || []);

                soft.forEach(s => allSoftSkills.add(s));
                inferredSoft.forEach(s => allSoftSkills.add(s));
                tech.forEach(s => allTechSkills.add(s));
                inferredTech.forEach(s => allTechSkills.add(s));

                if (inferredSoft.size > 0) inferredSoftMap.set(c.candidateId, inferredSoft);
                if (inferredTech.size > 0) inferredTechMap.set(c.candidateId, inferredTech);

                candidateSkillMap.set(c.candidateId, { soft, tech, inferredSoft, inferredTech });
            });

            const uniqueSoftSkills = Array.from(allSoftSkills).sort();
            const uniqueTechSkills = Array.from(allTechSkills).sort();

            // Function to generate horizontal skill table data
            const generateHorizontalSkillTable = (skillList, skillType, candidateSlice) => { // Added candidateSlice
                const head = [['Skill', ...candidateSlice.map(c => c.candidateId || 'Unknown')]]; // Use candidateSlice
                const body = skillList.map(skill => {
                    const row = [skill];
                    candidateSlice.forEach(c => { // Use candidateSlice
                        const skillsData = candidateSkillMap.get(c.candidateId); // candidateSkillMap should be accessible
                        const hasDirectSkill = skillsData?.[skillType]?.has(skill);
                        const hasInferredSkill = skillsData?.[`inferred${skillType.charAt(0).toUpperCase() + skillType.slice(1)}`]?.has(skill);

                        if (hasDirectSkill) {
                            row.push('/');
                        } else if (hasInferredSkill) {
                            row.push('*');
                        } else {
                            row.push('');
                        }
                    });
                    return row;
                });
                return { head, body };
            };

            // Add Soft Skills Table (Horizontal)
            if (uniqueSoftSkills.length > 0 && candidates.length > 0) { // Ensure there are candidates to display
                const maxCandidatesPerTablePage = 15;
                const numCandidateChunks = Math.ceil(candidates.length / maxCandidatesPerTablePage);

                for (let chunkIndex = 0; chunkIndex < numCandidateChunks; chunkIndex++) {
                    const startIdx = chunkIndex * maxCandidatesPerTablePage;
                    const endIdx = startIdx + maxCandidatesPerTablePage;
                    const candidateSlice = candidates.slice(startIdx, endIdx);

                    if (candidateSlice.length === 0) continue; // Should not happen with Math.ceil

                    pdf.addPage();
                    // Add full header for each new page that starts a candidate chunk.
                    // addHeaderFooter resets currentY to contentStartY.
                    addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true }); 
                    
                    let tableContentStartY = currentY; // This is contentStartY after addHeaderFooter

                    if (chunkIndex === 0) { // Main title and legend only for the very first chunk of this skill type
                        pdf.setFontSize(16);
                        pdf.setTextColor(60, 60, 60);
                        const setName = `(Set ${chunkIndex + 1} of ${numCandidateChunks})`;
                        pdf.text(`Soft Skills Comparison ${setName}`, pageWidth / 2, tableContentStartY, { align: 'center' });
                        tableContentStartY += 20;

                        const legendText = "(/) Skills directly extracted from resume    (*) Skills inferred by AI";
                        const legendFontSize = 8;
                        const legendLineHeight = legendFontSize * 1.15;

                        if (tableContentStartY + legendLineHeight > pageHeight - pageMargin - 15) {
                            pdf.addPage();
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true });
                            tableContentStartY = currentY; // Reset to new contentStartY
                        }
                        pdf.setFontSize(legendFontSize);
                        pdf.setTextColor(120, 120, 120);
                        pdf.setFont(undefined, 'italic');
                        pdf.text(legendText, pageWidth / 2, tableContentStartY, { align: 'center' });
                        pdf.setFont(undefined, 'normal');
                        tableContentStartY += legendLineHeight + 15;
                    } else { // "Continued" title for subsequent chunks of candidates
                        pdf.setFontSize(14); 
                        pdf.setTextColor(60, 60, 60);
                        const setName = `(Set ${chunkIndex + 1} of ${numCandidateChunks})`;
                        pdf.text(`Soft Skills Comparison ${setName}`, pageWidth / 2, tableContentStartY, { align: 'center' });
                        tableContentStartY += 20; 
                    }

                    const { head, body } = generateHorizontalSkillTable(uniqueSoftSkills, 'soft', candidateSlice);

                    autoTable(pdf, {
                        head: head,
                        body: body,
                        startY: tableContentStartY, 
                        margin: { left: pageMargin, right: pageMargin },
                        theme: 'grid',
                        styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' },
                        headStyles: { fillColor: [100, 100, 100], textColor: 255, fontSize: 8, halign: 'center' },
                        columnStyles: { 
                            0: { 
                                halign: 'left', 
                                fontStyle: 'bold', 
                                cellWidth: 150 
                            } 
                        },
                        didDrawPage: (data) => {
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: false }); 
                            data.cursor.y = currentY; // Start table content at top margin on this new page
                        }
                    });
                    currentY = pdf.lastAutoTable.finalY + 30; 
                }
            }

            // Add Technical Skills Table (Horizontal)
            if (uniqueTechSkills.length > 0 && candidates.length > 0) { // Ensure there are candidates to display
                const maxCandidatesPerTablePage = 15;
                const numCandidateChunks = Math.ceil(candidates.length / maxCandidatesPerTablePage);

                for (let chunkIndex = 0; chunkIndex < numCandidateChunks; chunkIndex++) {
                    const startIdx = chunkIndex * maxCandidatesPerTablePage;
                    const endIdx = startIdx + maxCandidatesPerTablePage;
                    const candidateSlice = candidates.slice(startIdx, endIdx);

                    if (candidateSlice.length === 0) continue; // Should not happen with Math.ceil

                    pdf.addPage();
                    addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true }); 
                    
                    let tableContentStartY = currentY; // This is contentStartY after addHeaderFooter

                    if (chunkIndex === 0) { 
                        pdf.setFontSize(16);
                        pdf.setTextColor(60, 60, 60);
                        const setName = `(Set ${chunkIndex + 1} of ${numCandidateChunks})`;
                        pdf.text(`Technical Skills Comparison ${setName}`, pageWidth / 2, tableContentStartY, { align: 'center' });
                        tableContentStartY += 20;

                        const legendText = "(/) Skills directly extracted from resume    (*) Skills inferred by AI";
                        const legendFontSize = 8;
                        const legendLineHeight = legendFontSize * 1.15;

                        if (tableContentStartY + legendLineHeight > pageHeight - pageMargin - 15) {
                            pdf.addPage();
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true });
                            tableContentStartY = currentY; // Reset to new contentStartY
                        }
                        pdf.setFontSize(legendFontSize);
                        pdf.setTextColor(120, 120, 120);
                        pdf.setFont(undefined, 'italic');
                        pdf.text(legendText, pageWidth / 2, tableContentStartY, { align: 'center' });
                        pdf.setFont(undefined, 'normal');
                        tableContentStartY += legendLineHeight + 15;
                    } else { // "Continued" title for subsequent chunks of candidates
                        pdf.setFontSize(14); 
                        pdf.setTextColor(60, 60, 60);
                        const setName = `(Set ${chunkIndex + 1} of ${numCandidateChunks})`;
                        pdf.text(`Technical Skills Comparison ${setName}`, pageWidth / 2, tableContentStartY, { align: 'center' });
                        tableContentStartY += 20; 
                    }

                    // Generate table data for the current slice of candidates
                    const { head, body } = generateHorizontalSkillTable(uniqueTechSkills, 'tech', candidateSlice);

                    autoTable(pdf, {
                        head: head,
                        body: body,
                        startY: tableContentStartY, // Table starts after title/legend or continued title
                        margin: { left: pageMargin, right: pageMargin },
                        theme: 'grid',
                        styles: { fontSize: 8, cellPadding: 2, halign: 'center', valign: 'middle' },
                        headStyles: { fillColor: [100, 100, 100], textColor: 255, fontSize: 8, halign: 'center' },
                        columnStyles: { 
                            0: { 
                                halign: 'left', 
                                fontStyle: 'bold', 
                                cellWidth: 150 // Fixed width for the skill name column
                            } 
                            // Candidate columns will auto-adjust width based on remaining space and number of candidates in the slice
                        },
                        didDrawPage: (data) => {
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: false }); 
                            // currentY is now pageMargin (from addHeaderFooter with drawHeader:false)
                            data.cursor.y = currentY; // Start table content at top margin on this new page
                        }
                    });
                    currentY = pdf.lastAutoTable.finalY + 30; 
                }
            }

            // --- Page 2+: Criteria Scores Tables ---
            selectedCriteria.forEach(criteria => {
                const subCriteria = Object.keys(weights[criteria]);
                const subCriteriaNames = subCriteria.map(sub => criteriaDisplayNames[criteria][sub] || sub);
                const criteriaColor = hexToRgb(signatureColors[criteria]);

                // --- Create multi-row header (defined once per criterion) ---
                const head = [
                    [ // Row 1
                        { content: 'Candidate', rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                        ...subCriteriaNames.map(name => ({ content: name, colSpan: 2, styles: { halign: 'center' } })),
                        { content: 'Total Score', rowSpan: 2, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } } // New: Total Score header
                    ],
                    [ // Row 2
                        ...subCriteria.flatMap(() => ['Raw', 'Weighted'])
                        // No cell needed here for Total Score due to rowSpan in Row 1
                    ]
                ];

                const maxCandidatesPerScorePage = 30;
                const numCandidateChunks = Math.ceil(candidates.length / maxCandidatesPerScorePage); // Ensure 'candidates' is the correct array (e.g., pdfCandidates)

                for (let chunkIndex = 0; chunkIndex < numCandidateChunks; chunkIndex++) {
                    const startIdx = chunkIndex * maxCandidatesPerScorePage;
                    const endIdx = startIdx + maxCandidatesPerScorePage;
                    const candidateSlice = candidates.slice(startIdx, endIdx); // Ensure 'candidates' is the correct array

                    if (candidateSlice.length === 0) continue;

                    pdf.addPage();
                    addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true });
                    
                    let tableContentStartY = currentY;

                    pdf.setFontSize(16);
                    pdf.setTextColor(criteriaColor.r, criteriaColor.g, criteriaColor.b);
                    let titleText = `${criteria.charAt(0).toUpperCase() + criteria.slice(1)} Scores Summary`;
                    if (numCandidateChunks > 1) {
                        titleText += ` (Set ${chunkIndex + 1} of ${numCandidateChunks})`;
                    }
                    pdf.text(titleText, pageWidth / 2, tableContentStartY, { align: 'center' });
                    tableContentStartY += 30;

                    // --- Create body with raw and weighted scores for the current chunk ---
                    const body = candidateSlice.map(candidate => {
                        const rowData = [candidate.candidateId || 'Unknown'];
                        let criterionTotalWeightedScore = 0; // Initialize total for this criterion for this candidate
                        subCriteria.forEach(sub => {
                            const rawScore = candidate.rank_score?.[sub] || 0;
                            const weight = weights[criteria][sub] || 0;
                            const weightedScore = rawScore * weight;
                            rowData.push(rawScore.toFixed(1)); 
                            rowData.push(weightedScore.toFixed(2)); 
                            criterionTotalWeightedScore += weightedScore; // Accumulate weighted score
                        });
                        rowData.push(criterionTotalWeightedScore.toFixed(2)); // New: Add the sum of weighted scores for the criterion
                        return rowData;
                    });

                    autoTable(pdf, {
                        head: head,
                        body: body,
                        startY: tableContentStartY,
                        margin: { left: pageMargin, right: pageMargin },
                        theme: 'grid',
                        headStyles: {
                            fillColor: [criteriaColor.r, criteriaColor.g, criteriaColor.b],
                            textColor: 255,
                            halign: 'center'
                        },
                        styles: {
                            fontSize: 9,
                            cellPadding: 3,
                            halign: 'center'
                        },
                        columnStyles: {
                            0: { cellWidth: 'auto', halign: 'left' }, // Candidate ID column
                            // New: Style for the 'Total Score' column (last data column)
                            // Index is 1 (Candidate) + (number of subCriteria * 2 for Raw/Weighted)
                            [1 + subCriteria.length * 2]: { fontStyle: 'bold', halign: 'center' }
                        },
                        didDrawPage: (data) => {
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: false });
                            data.cursor.y = currentY; 
                        }
                    });
                    let scoresTableFinalY = pdf.lastAutoTable.finalY;

                    if (chunkIndex === numCandidateChunks - 1) {
                        const weightageTableWidth = 120;
                        const weightageTableHeightEstimate = 20 + (subCriteria.length * 15) + 10;
                        const weightageTableStartX = pageWidth - pageMargin - weightageTableWidth;
                        let weightageTableStartY = pageHeight - pageMargin - 15 - weightageTableHeightEstimate;

                        if (weightageTableStartY <= scoresTableFinalY + 10) {
                            pdf.addPage();
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true }); 
                            weightageTableStartY = pageHeight - pageMargin - 15 - weightageTableHeightEstimate; 
                        }

                        const weightageHead = [['Sub-Criterion', 'Weight']];
                        const weightageBody = subCriteria.map(sub => [
                            criteriaDisplayNames[criteria][sub] || sub,
                            (weights[criteria][sub] || 0).toFixed(2)
                        ]);

                        autoTable(pdf, {
                            head: weightageHead,
                            body: weightageBody,
                            startY: weightageTableStartY,
                            margin: { left: weightageTableStartX, right: pageMargin },
                            tableWidth: weightageTableWidth,
                            theme: 'plain',
                            headStyles: { fillColor: [220, 220, 220], textColor: 50, fontStyle: 'bold' },
                            styles: { fontSize: 8, cellPadding: 2 },
                            columnStyles: {
                                0: { cellWidth: 'auto' },
                                1: { cellWidth: 40, halign: 'right' }
                            }
                        });
                        currentY = pdf.lastAutoTable.finalY + 20;
                    } else {
                        currentY = scoresTableFinalY + 20;
                    }
                } 
            });

            // --- New Page: Total Candidate Score Table ---
            if (selectedCriteria.length > 0 && candidates.length > 0) { // Only show if there are criteria and candidates
                const maxCandidatesPerTotalScorePage = 30; // Or your preferred number
                const numTotalScoreCandidateChunks = Math.ceil(candidates.length / maxCandidatesPerTotalScorePage);

                for (let chunkIndex = 0; chunkIndex < numTotalScoreCandidateChunks; chunkIndex++) {
                    const startIdx = chunkIndex * maxCandidatesPerTotalScorePage;
                    const endIdx = startIdx + maxCandidatesPerTotalScorePage;
                    const candidateSlice = candidates.slice(startIdx, endIdx); // Ensure 'candidates' is the correct array (e.g., pdfCandidates)

                    if (candidateSlice.length === 0) continue;

                    pdf.addPage();
                    addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true });
                    let tableContentStartY = currentY; // currentY is reset by addHeaderFooter

                    // --- Title ---
                    pdf.setFontSize(18);
                    pdf.setTextColor(60, 60, 60); // Neutral color for this summary title
                    let totalScorePageTitle = "Total Candidate Score";
                     if (numTotalScoreCandidateChunks > 1) {
                        totalScorePageTitle += ` (Set ${chunkIndex + 1} of ${numTotalScoreCandidateChunks})`;
                    }
                    pdf.text(totalScorePageTitle, pageWidth / 2, tableContentStartY, { align: 'center' });
                    tableContentStartY += 20;

                    // --- Legend ---
                    if (chunkIndex === 0) { // Show legend only on the first page of this section
                        const legendText = "Each criterion is given equal weightage for the Final Balanced Score.";
                        const legendFontSize = 9;
                        const legendLineHeight = legendFontSize * 1.15;
                        if (tableContentStartY + legendLineHeight > pageHeight - pageMargin - 15) {
                            pdf.addPage();
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: true });
                            tableContentStartY = currentY;
                        }
                        pdf.setFontSize(legendFontSize);
                        pdf.setTextColor(120, 120, 120);
                        pdf.setFont(undefined, 'italic');
                        pdf.text(legendText, pageWidth / 2, tableContentStartY, { align: 'center' });
                        pdf.setFont(undefined, 'normal');
                        tableContentStartY += legendLineHeight + 15;
                    }


                    // --- Prepare Table Data for this Chunk ---
                    const totalScoreTableHeadRow = ['Candidate'];
                    selectedCriteria.forEach(critName => {
                        totalScoreTableHeadRow.push(`${critName.charAt(0).toUpperCase() + critName.slice(1)} Total`);
                    });
                    totalScoreTableHeadRow.push('Final Balanced Score');
                    const totalScoreTableHead = [totalScoreTableHeadRow];

                    const totalScoreTableBody = candidateSlice.map(candidate => {
                        const row = [candidate.candidateId || 'Unknown'];
                        let sumOfCriterionTotals = 0;
                        let actualCriteriaCountForCandidate = 0;

                        selectedCriteria.forEach(criteriaName => {
                            const subCriteriaForThis = Object.keys(weights[criteriaName] || {});
                            let currentCriterionTotal = 0;
                            if (subCriteriaForThis.length > 0) { // Ensure the criterion has sub-criteria defined in weights
                                subCriteriaForThis.forEach(sub => {
                                    const rawScore = candidate.rank_score?.[sub] || 0;
                                    const weight = weights[criteriaName]?.[sub] || 0;
                                    currentCriterionTotal += rawScore * weight;
                                });
                                actualCriteriaCountForCandidate++;
                            }
                            row.push(currentCriterionTotal.toFixed(2));
                            sumOfCriterionTotals += currentCriterionTotal;
                        });

                        const finalBalancedScore = actualCriteriaCountForCandidate > 0 
                            ? (sumOfCriterionTotals / actualCriteriaCountForCandidate).toFixed(2) 
                            : '0.00';
                        row.push(finalBalancedScore);
                        return row;
                    });

                    // --- Column Styles ---
                    const columnStylesTotalScore = {
                        0: { cellWidth: 'auto', halign: 'left' }, // Candidate ID
                        [totalScoreTableHeadRow.length - 1]: { fontStyle: 'bold', halign: 'center' } // Last column (Final Balanced Score)
                    };

                    autoTable(pdf, {
                        head: totalScoreTableHead,
                        body: totalScoreTableBody,
                        startY: tableContentStartY,
                        margin: { left: pageMargin, right: pageMargin },
                        theme: 'grid',
                        headStyles: { fillColor: [100, 100, 100], textColor: 255, halign: 'center', fontStyle: 'bold' },
                        styles: { fontSize: 9, cellPadding: 3, halign: 'center' },
                        columnStyles: columnStylesTotalScore,
                        didDrawPage: (data) => {
                            addHeaderFooter(pdf.internal.getNumberOfPages(), { drawHeader: false });
                            data.cursor.y = currentY;
                        }
                    });
                    currentY = pdf.lastAutoTable.finalY + 30;
                }
            }

            // --- Page Y+: Individual Candidate Details (ApplicantDetails Format) ---
            const addWrappedText = (text, x, y, maxWidth, options = {}) => {
                const lines = pdf.splitTextToSize(text || "N/A", maxWidth);
                const lineHeight = (options.lineHeightFactor || 1.15) * pdf.getFontSize();
                const neededHeight = lines.length * lineHeight;

                // Check for page break before drawing text
                if (y + neededHeight > pageHeight - pageMargin - 15) { // Check against bottom margin + footer
                    pdf.addPage();
                    addHeaderFooter(pdf.internal.getNumberOfPages()); // Will reset currentY to contentStartY
                    y = currentY; // Use the reset currentY value
                }
                pdf.text(lines, x, y, options);
                return y + neededHeight;
            };

            // Helper to render items like tags horizontally
            const renderSkillsHorizontally = (items, y, options = {}) => {
                const itemFontSize = options.fontSize || 10; // Approx 0.8rem
                const itemColor = options.color || hexToRgb('#8250c8'); // Default to skill-tag color
                const inferredMarker = options.inferredMarker || " *"; // Changed marker to just asterisk
                const itemPaddingX = 10; // Horizontal space between items
                const itemPaddingY = 5; // Vertical space between lines
                const lineHeightFactor = options.lineHeightFactor || 1.3;
                const lineHeight = itemFontSize * lineHeightFactor;
                const availableWidth = pageWidth - 2 * pageMargin - 10; // Max width for text line

                pdf.setFontSize(itemFontSize);
                pdf.setTextColor(itemColor.r, itemColor.g, itemColor.b);
                pdf.setFont(undefined, 'normal'); // Ensure not bold

                if (!items || items.length === 0) {
                    y = addWrappedText("N/A", pageMargin + 10, y, availableWidth, { lineHeightFactor });
                    y += 5; // Add small space after N/A
                    return y;
                }

                let currentX = pageMargin + 10;

                items.forEach((item, index) => {
                    let textToRender = item.text || item; // Handle both object and string arrays
                    if (item.isInfered) {
                        textToRender += inferredMarker; // Append the asterisk marker
                    }

                    const textWidth = pdf.getTextWidth(textToRender);

                    // Check if item fits on the current line
                    if (currentX + textWidth > pageMargin + availableWidth) {
                        // Move to the next line
                        currentX = pageMargin + 10;
                        y += lineHeight + itemPaddingY;

                        // Check for page break before drawing the new line
                        if (currentX + textWidth > pageMargin + availableWidth) {
                            // Move to the next line
                            currentX = pageMargin + 10;
                            y += lineHeight + itemPaddingY;

                            // Check for page break before drawing the new line
                            if (y + lineHeight > pageHeight - pageMargin - 15) {
                                pdf.addPage();
                                addHeaderFooter(pdf.internal.getNumberOfPages()); // Will reset currentY to contentStartY
                                y = currentY; // Use the reset currentY value

                                // Re-apply styles for the new page
                                pdf.setFontSize(itemFontSize);
                                pdf.setTextColor(itemColor.r, itemColor.g, itemColor.b);
                                pdf.setFont(undefined, 'normal');
                            }
                        }
                    }

                    // Draw the text
                    pdf.text(textToRender, currentX, y);
                    currentX += textWidth + itemPaddingX; // Move X for the next item
                });

                // Return the Y position after the last line of skills
                return y + lineHeight;
            };


            // Helper to render structured content with better date positioning
            const renderStructuredContent = (items, y) => {
                const maxWidth = pageWidth - 2 * pageMargin - 10;
                const titleFontSize = 11;
                const descFontSize = 10;
                const lineHeightFactor = 1.2;
                const datePadding = 10; // Reduced padding between title and date

                if (!items || items.length === 0) {
                    y = addWrappedText("N/A", pageMargin + 10, y, maxWidth, { fontSize: descFontSize, lineHeightFactor });
                    y += 10;
                    return y;
                }

                items.forEach(itemContent => {
                    if (!itemContent) return;

                    const lines = itemContent.split('\n');
                    let titleLine = lines[0] || '';
                    const descriptionLines = lines.slice(1).filter(line => line.trim() !== ''); // Filter empty lines

                    // Remove <strong> tags and extract date
                    let displayTitle = titleLine.replace(/<\/?strong>/g, '').trim(); // Remove <strong> tags
                    let dateInfo = null;
                    const datePattern = /\[(.*?)\]/g;
                    const dateMatch = datePattern.exec(displayTitle); // Check title *after* removing strong tags
                    if (dateMatch) {
                        displayTitle = displayTitle.replace(datePattern, '').trim();
                        dateInfo = dateMatch[1];
                    }

                    // Check for page break before drawing title
                    if (y + 20 > pageHeight - pageMargin - 15) {
                        pdf.addPage();
                        addHeaderFooter(pdf.internal.getNumberOfPages());
                        y = currentY;

                        // Re-apply font settings
                        pdf.setFontSize(titleFontSize);
                        pdf.setTextColor(50, 50, 50);
                    }

                    // Set font for title
                    pdf.setFontSize(titleFontSize);
                    pdf.setTextColor(50, 50, 50);
                    pdf.setFont(undefined, 'bold');

                    // Calculate better positions for title and date
                    const dateWidth = dateInfo ? pdf.getTextWidth(`[${dateInfo}]`) + 5 : 0; // Minimal date padding
                    const maxTitleWidth = maxWidth - dateWidth - 30; // Add extra margin between title and date

                    // Draw title with proper wrapping
                    const titleLines = pdf.splitTextToSize(displayTitle, maxTitleWidth);
                    const titleHeight = titleLines.length * titleFontSize * lineHeightFactor;
                    pdf.text(titleLines, pageMargin + 10, y);

                    // Draw date aligned closer to content area, not all the way to the right edge
                    if (dateInfo) {
                        pdf.setFont(undefined, 'normal');
                        pdf.setTextColor(80, 80, 80);
                        // Position date with a reasonable right margin
                        pdf.text(`[${dateInfo}]`, pageWidth - pageMargin - dateWidth - 10, y);
                    }

                    // Move Y position below the title (accounting for multi-line titles)
                    y += titleHeight + 5;

                    // Draw Description (Normal font)
                    pdf.setFontSize(descFontSize);
                    pdf.setTextColor(80, 80, 80);
                    pdf.setFont(undefined, 'normal');
                    descriptionLines.forEach(line => {
                        const cleanedLine = line.trim().startsWith('•') ? line.trim() : `• ${line.trim()}`;
                        y = addWrappedText(cleanedLine, pageMargin + 20, y, maxWidth - 10, { lineHeightFactor });
                        y += 3; // Space between description points
                    });

                    y += 15; // Space after the entire entry
                });

                return y;
            };

            candidates.forEach((candidate) => {
                pdf.addPage();
                addHeaderFooter(pdf.internal.getNumberOfPages()); // Adds header/footer, resets currentY

                pdf.setFontSize(18);
                pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.text(`Candidate Details: ${candidate.candidateId || "Unknown"}`, pageWidth / 2, currentY, { align: 'center' });
                currentY += 30;

                const profile = candidate.detailed_profile || {};
                let skillsRendered = false; // Flag to check if any skills were shown

                // --- Skills Section ---
                if (currentY + 40 > pageHeight - pageMargin - 15) {
                    pdf.addPage();
                    addHeaderFooter(pdf.internal.getNumberOfPages()); // Will reset currentY to contentStartY
                    // No need to explicitly set currentY again as addHeaderFooter now sets it correctly
                }
                pdf.setFontSize(14);
                const skillsColor = hexToRgb(signatureColors.skills);
                pdf.setTextColor(skillsColor.r, skillsColor.g, skillsColor.b);
                pdf.setFont(undefined, 'normal'); // Section title not bold
                pdf.text("Skills", pageMargin, currentY);
                currentY += 25;

                // Soft Skills (Horizontal)
                const hasSoftSkills = profile.soft_skills?.length > 0 || profile.inferred_soft_skills?.length > 0;
                if (hasSoftSkills) {
                    skillsRendered = true; // Mark that skills are being rendered
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11);
                    pdf.setTextColor(80, 80, 80);
                    pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Soft Skills:", pageMargin + 10, currentY);
                    currentY += 18;
                    const softItems = [
                        ...(profile.soft_skills || []).map(s => ({ text: s })),
                        ...(profile.inferred_soft_skills || []).map(s => ({ text: s, isInfered: true })),
                    ];
                    currentY = renderSkillsHorizontally(softItems, currentY, {
                        color: hexToRgb('#8250c8'),
                        fontSize: 10
                    });
                    currentY += 10;
                }

                // Technical Skills (Horizontal)
                const hasTechSkills = profile.technical_skills?.length > 0 || profile.inferred_technical_skills?.length > 0;
                if (hasTechSkills) {
                    skillsRendered = true; // Mark that skills are being rendered
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11);
                    pdf.setTextColor(80, 80, 80);
                    pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Technical Skills:", pageMargin + 10, currentY);
                    currentY += 18;
                    const techItems = [
                        ...(profile.technical_skills || []).map(s => ({ text: s })),
                        ...(profile.inferred_technical_skills || []).map(s => ({ text: s, isInfered: true })),
                    ];
                    currentY = renderSkillsHorizontally(techItems, currentY, {
                        color: hexToRgb('#8250c8'),
                        fontSize: 10
                    });
                    currentY += 10;
                }

                // Language (Horizontal)
                const hasLanguages = profile.language?.length > 0 || profile.inferred_language?.length > 0;
                if (hasLanguages) {
                    skillsRendered = true; // Mark that skills/languages are being rendered
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11);
                    pdf.setTextColor(80, 80, 80);
                    pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Language:", pageMargin + 10, currentY); // Changed text to "Language:"
                    currentY += 18;

                    // Prepare items for rendering (adjust field names as needed)
                    const languageItems = [
                        ...(profile.language || []).map(lang => ({ text: lang })),
                        ...(profile.inferred_language || []).map(lang => ({ text: lang, isInfered: true })),
                    ];

                    // Render the languages horizontally
                    currentY = renderSkillsHorizontally(languageItems, currentY, {
                        color: hexToRgb('#5a9bd5'), // Optional: Use a different color for languages
                        fontSize: 10
                    });
                    currentY += 10; // Add spacing after the language section
                }

                // --- Add Skills Note ---
                if (skillsRendered) {
                    const noteText = "(*) means it is AI inferred skills";
                    const noteFontSize = 8;
                    const noteLineHeight = noteFontSize * 1.15;

                    // Check for page break before adding note
                    if (currentY + noteLineHeight > pageHeight - pageMargin - 15) {
                        pdf.addPage();
                        addHeaderFooter(pdf.internal.getNumberOfPages());
                    }
                    pdf.setFontSize(noteFontSize);
                    pdf.setTextColor(120, 120, 120); // Lighter grey color
                    pdf.setFont(undefined, 'italic');
                    pdf.text(noteText, pageWidth - pageMargin, currentY, { align: 'right' });
                    pdf.setFont(undefined, 'normal'); // Reset font style
                    currentY += noteLineHeight + 5; // Add space after the note
                } else {
                    // If no skills were rendered, still add some spacing before next section
                    currentY += 15;
                }

                // --- Experience Section ---
                if (currentY + 40 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                pdf.setFontSize(14);
                const expColor = hexToRgb(signatureColors.experience);
                pdf.setTextColor(expColor.r, expColor.g, expColor.b);
                pdf.setFont(undefined, 'normal'); // Section title not bold
                pdf.text("Experience", pageMargin, currentY);
                currentY += 25;

                // Work Experience
                if (profile.work_experience?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Work Experience:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.work_experience, currentY);
                }
                // Projects
                if (profile.projects?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Projects:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.projects, currentY);
                }
                // Co-curricular
                if (profile.co_curricular_activities?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Co-curricular Activities:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.co_curricular_activities, currentY);
                }
                currentY += 15; // Spacing after Experience section


                // --- Education Section ---
                if (currentY + 40 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                pdf.setFontSize(14);
                const eduColor = hexToRgb(signatureColors.education);
                pdf.setTextColor(eduColor.r, eduColor.g, eduColor.b);
                pdf.setFont(undefined, 'normal'); // Section title not bold
                pdf.text("Education", pageMargin, currentY);
                currentY += 25;

                // Education Level
                if (profile.education?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Education Level:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.education, currentY);
                }
                // Certifications
                if (profile.certifications?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Certifications:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.certifications, currentY);
                }
                // Awards
                if (profile.awards?.length > 0) {
                    if (currentY + 20 > pageHeight - pageMargin - 15) { pdf.addPage(); addHeaderFooter(pdf.internal.getNumberOfPages()); }
                    pdf.setFontSize(11); pdf.setTextColor(80, 80, 80); pdf.setFont(undefined, 'normal'); // Sub-header not bold
                    pdf.text("Awards:", pageMargin + 10, currentY); currentY += 18;
                    currentY = renderStructuredContent(profile.awards, currentY);
                }
                currentY += 15; // Spacing after Education section

            });

            // --- Save PDF ---
            const filename = `${selectedJob.jobTitle.replace(/[\s/\\?%*:|"<>]/g, '_')}_candidate_report.pdf`;
            pdf.save(filename);

            setShowInfoModal(false);
            setModalMessage("PDF report generated successfully!");
            setShowSuccessModal(true);

        } catch (error) {
            console.error("Error generating PDF:", error);
            setShowInfoModal(false);
            const errorMessage = error instanceof Error ? error.message : String(error);
            setModalMessage(`Failed to generate PDF: ${errorMessage}`);
            setShowErrorModal(true);
        }
    };

    if (isLoading) {
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
                    <p style={{ marginTop: '20px' }}>Loading jobs...</p>
                </div>
            </div>
        );
    }

    // Add loading state for job details view
    if (selectedJob && jobDetailLoading) {
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
                    <p style={{ marginTop: '20px', fontSize: '1.1rem', fontWeight: '500' }}>
                        {jobLoadingMessage || "Loading job details..."}
                    </p>
                </div>
            </div>
        );
    }

    // Add loading state for rank details view
    if (selectedJob && rankDetailLoading) {
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
                    <p style={{ marginTop: '20px', fontSize: '1.1rem', fontWeight: '500' }}>
                        {uploadMessage || rankingMessage || "Processing candidates..."}
                    </p>
                    <p style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
                        This may take a moment as we analyze and rank the candidates
                    </p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="dashboard-container">
                <div className="error-message">
                    <h3>Error</h3>
                    <p>{error}</p>
                    <button onClick={() => window.location.reload()}>Retry</button>
                </div>
            </div>
        );
    }

    const InfoModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal info-modal">
                <div className="status-icon info-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#2196f3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                </div>
                <h3 className="status-title">{!modalMessage.includes("export") ? "Please Hold" : "Information"}</h3>
                <p className="status-description">{modalMessage}</p>
                <div className="status-buttons">
                    {!modalMessage.includes("PDF") && (
                        <button className="status-button primary-button" onClick={() => setShowInfoModal(false)}>
                            OK
                        </button>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div className="dashboard-container">
            {showSuccessModal && <SuccessModal />}
            {showErrorModal && <ErrorModal />}
            {showInfoModal && <InfoModal />}
            {showRankSuccessModal && <RankSuccessModal />}
            {showRankErrorModal && <RankErrorModal />}
            {showExportModal && <ExportModal />}
            {showConfirmModal && <ConfirmModal />}
            {showUploadCVModal && (
                <UploadMoreCVModal  // Updated component name
                    isOpen={showUploadCVModal}
                    onClose={() => setShowUploadCVModal(false)}
                    jobId={selectedJob?.jobId}
                    jobTitle={selectedJob?.jobTitle}
                    onUploadComplete={handleUploadComplete}
                />
            )}
            {showRankApplicantsModal && (
                <RankApplicantsModal
                    isOpen={showRankApplicantsModal}
                    onClose={() => setShowRankApplicantsModal(false)}
                    jobId={selectedJob?.jobId}
                    jobTitle={selectedJob?.jobTitle}
                    onSubmit={handlePromptComplete}
                    currentPrompt={selectedJob?.prompt || ""}
                />
            )}
            {showRankCriteriaModal && (
                <RankCriteriaModal
                    isOpen={showRankCriteriaModal}
                    onClose={() => setShowRankCriteriaModal(false)}
                    prompt={selectedJob?.prompt || ""}
                />
            )}
            {!selectedJob ? (
                <>
                    <div className="dashboard-header">
                        <h1>Job Dashboard</h1>
                        <button className="create-job-button" onClick={handleCreateNewJob}>Create New Job</button>
                    </div>

                    <div className="search-container">
                        <div className="search-input-wrapper">
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search jobs..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                            />
                            <select
                                className="search-category"
                                value={searchCategory}
                                onChange={handleCategoryChange}
                            >
                                <option value="jobTitle">Job Title</option>
                                <option value="department">Department</option>
                                <option value="requiredSkills">Required Skills</option>
                            </select>
                        </div>

                        <div className="sort-container">
                            <label htmlFor="sort-select">Sort by:</label>
                            <select
                                id="sort-select"
                                className="sort-select"
                                value={sortBy}
                                onChange={handleSortChange}
                            >
                                <option value="latest">Latest</option>
                                <option value="oldest">Oldest</option>
                                <option value="most-applications">Most Applications</option>
                                <option value="a-z">A-Z</option>
                                <option value="z-a">Z-A</option>
                            </select>
                        </div>
                    </div>

                    <div className="jobs-list-single-column">
                        {sortedJobs.length === 0 ? (
                            <div className="no-jobs">
                                <p>No jobs found matching your search.</p>
                            </div>
                        ) : (
                            sortedJobs.map((job) => (
                                <div
                                    key={job.jobId}
                                    className="job-card-row"
                                    data-job-id={job.jobId}
                                    onClick={() => handleJobSelect(job)}
                                >
                                    <div className="job-card-main-content">
                                        <h3 className="job-card-title">{job.jobTitle}</h3>
                                        <div
                                            className={`job-card-description ${expandedDescriptions[job.jobId] ? 'expanded' : ''}`}
                                            onClick={(e) => e.stopPropagation()} // Prevent click from triggering job selection
                                        >
                                            {job.jobDescription}
                                            {job.jobDescription && job.jobDescription.length > 250 && (
                                                <span
                                                    className="read-more-toggle"
                                                    onClick={(e) => toggleDescriptionExpansion(e, job.jobId)}
                                                >
                                                    {expandedDescriptions[job.jobId] ? ' ...READ LESS' : ' ...READ MORE'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="job-card-departments">
                                            {job.departments.length > 0 ? (
                                                job.departments.map((dept, index) => (
                                                    <span key={index} className="department-tag">{dept}</span>
                                                ))
                                            ) : (
                                                <span className="department-tag" style={{ opacity: 0.6 }}>No departments specified</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="job-card-side-content">
                                        <p className="job-card-date">
                                            <span className="detail-label">Posted: </span>
                                            {formatDate(job.createdAt)}
                                        </p>
                                        <p className="job-card-applications">
                                            <span className="detail-label">Applications: </span>
                                            {job.applicationCount || 0}
                                        </p>
                                        <div className="job-card-skills">
                                            <span className="detail-label">Required Skills: </span>
                                            <div className={`skills-tags ${expandedSkillSets[job.jobId] ? 'expanded' : 'collapsed'}`}>
                                                {job.requiredSkills && job.requiredSkills.length > 0 ?
                                                    renderSkillsWithCount(job.requiredSkills, expandedDescriptions[job.jobId], job.jobId) :
                                                    <span className="skill-tag" style={{ opacity: 0.6 }}>None specified</span>
                                                }
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            ) : (
                <div className="job-detail-view">
                    <button className="back-button" onClick={handleBackToJobs}>
                        <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path>
                        </svg>
                        Back
                    </button>
                    <div className="job-detail-header">
                        <h2>{selectedJob.jobTitle}</h2>
                        <div className="job-actions">
                            {!isEditing ? (
                                <>
                                    <button className="edit-job-button" onClick={handleEditToggle}>
                                        Edit Job
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        className="cancel-button"
                                        onClick={handleCancelClick}
                                    >
                                        Cancel
                                    </button>
                                    <button className="edit-job-button" onClick={handleSaveChanges}>
                                        Save Changes
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="job-detail-content">
                        <div className={`job-info-container ${isEditing && jobDetailsExpanded ? 'editing-job-active' : ''}`}>
                            <div className={`collapsible-header ${!jobDetailsExpanded ? 'collapsed' : ''}`}
                                onClick={toggleJobDetails}>
                                <h3>
                                    Job Details
                                    <div className="collapse-icon">
                                        {jobDetailsExpanded ? (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="18 15 12 9 6 15"></polyline>
                                            </svg>
                                        ) : (
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="6 9 12 15 18 9"></polyline>
                                            </svg>
                                        )}
                                    </div>
                                </h3>

                                {!isEditing && (
                                    <div className="header-actions">
                                        <button
                                            className="dashboard-action-button export-button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleExportScores();
                                            }}
                                            title="Export all candidates' scores"
                                        >
                                            Export Candidates
                                        </button>
                                        <button
                                            className="interview-questions-button"
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent toggling when clicking the button
                                                handleInterviewQuestionsClick();
                                            }}
                                        >
                                            Interview Questions
                                        </button>
                                    </div>
                                )}
                            </div>

                            {jobDetailsExpanded && (
                                <>
                                    {isEditing ? (
                                        <div className="job-edit-form">
                                            <div className="form-group">
                                                <label>Job Title</label>
                                                <input
                                                    type="text"
                                                    name="jobTitle"
                                                    value={editedJob.jobTitle}
                                                    onChange={handleInputChange}
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label>Job Description</label>
                                                <textarea
                                                    name="jobDescription"
                                                    value={editedJob.jobDescription}
                                                    onChange={handleInputChange}
                                                    ref={descriptionTextareaRef}
                                                    className="auto-resize-textarea"
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label>Minimum CGPA</label>
                                                <input
                                                    type="number"
                                                    name="minimumCGPA"
                                                    value={editedJob.minimumCGPA}
                                                    onChange={handleInputChange}
                                                    onBlur={handleMinimumCGPABlur}
                                                    step="0.01"
                                                    min="0"
                                                    max="4.0"
                                                />
                                            </div>

                                            {/* Editable departments field */}
                                            <div className="form-group">
                                                <label>Departments</label>
                                                <div className="suggestion-container">
                                                    <div className="input-group">
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            value={departmentInput}
                                                            onChange={(e) => setDepartmentInput(e.target.value)}
                                                            onKeyPress={handleDepartmentKeyPress}
                                                            placeholder="Enter a department"
                                                            onBlur={() => {
                                                                setTimeout(() => {
                                                                    setShowDepartmentSuggestions(false);
                                                                }, 200);
                                                            }}
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
                                                                        e.preventDefault();
                                                                        handleDepartmentSelect(suggestion);
                                                                    }}
                                                                >
                                                                    {suggestion}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                                {editedJob.departments && editedJob.departments.length > 0 && (
                                                    <div className="tags-container departments-container">
                                                        {editedJob.departments.map((department, index) => (
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
                                            </div>

                                            {/* Editable required skills field */}
                                            <div className="form-group">
                                                <label>Required Skills</label>
                                                <div className="suggestion-container">
                                                    <div className="input-group">
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            value={skillInput}
                                                            onChange={(e) => setSkillInput(e.target.value)}
                                                            onKeyPress={handleSkillKeyPress}
                                                            placeholder="Enter a skill"
                                                            onBlur={() => {
                                                                setTimeout(() => {
                                                                    setShowSkillSuggestions(false);
                                                                }, 200);
                                                            }}
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
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        handleSkillSelect(suggestion);
                                                                    }}
                                                                >
                                                                    {suggestion}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                                {editedJob.requiredSkills && editedJob.requiredSkills.length > 0 && (
                                                    <div className="tags-container skills-container">
                                                        {editedJob.requiredSkills && editedJob.requiredSkills.length > 0 && (
                                                            <div className="tags-container skills-container"> {/* Using 'skills-container' for potential specific styling */}
                                                                {editedJob.requiredSkills.map((skill, index) => (
                                                                    // Use SkillTagWithLogo here. 
                                                                    // It will use its default purple theme because 'unstyled' is not passed (or is false).
                                                                    <SkillTagWithLogo
                                                                        key={`edit-job-skill-${index}-${skill}`}
                                                                        skillName={skill}
                                                                    >
                                                                        <button
                                                                            type="button"
                                                                            className="tag-remove-logo" // Styled by SkillTagWithLogo.css
                                                                            onClick={() => removeSkill(skill)}
                                                                            aria-label={`Remove skill ${skill}`}
                                                                        >
                                                                            ×
                                                                        </button>
                                                                    </SkillTagWithLogo>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="job-info">
                                            <div className="info-columns">
                                                <div className="info-column">
                                                    <div className="info-group">
                                                        <p className="info-label">Posted:</p>
                                                        <p className="info-value">{formatDate(selectedJob.createdAt)}</p>
                                                    </div>

                                                    <div className="info-group">
                                                        <p className="info-label">Departments:</p>
                                                        <div className="departments-display">
                                                            {selectedJob.departments.map((dept, index) => (
                                                                <span key={index} className="department-tag">{dept}</span>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    <div className="info-group">
                                                        <p className="info-label">Minimum CGPA:</p>
                                                        <p className="info-value">{formatCGPA(selectedJob.minimumCGPA)}</p>
                                                    </div>

                                                    <div className="info-group">
                                                        <p className="info-label">Required Skills:</p>
                                                        <div className="skills-display"> {/* This div helps with flex-wrap if needed */}
                                                            {selectedJob.requiredSkills && selectedJob.requiredSkills.length > 0 ? (
                                                                selectedJob.requiredSkills.map((skill, index) => (
                                                                    <SkillTagWithLogo 
                                                                        key={`detail-skill-${index}-${skill}`} // Make key more unique 
                                                                        skillName={skill} 
                                                                    />
                                                                ))
                                                            ) : (
                                                                <SkillTagWithLogo skillName="None specified" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                            </div>

                                            <div className="info-group description-group">
                                                <p className="info-label">Description:</p>
                                                <p className="info-value" style={{ whiteSpace: 'pre-line' }}>
                                                    {selectedJob.jobDescription || "No description provided."}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="job-info-container">
                            <div className="applicants-header">
                                <h3>Applicants ({filteredApplicants.length})</h3>
                                {!isEditing && (
                                    <div className="applicants-actions">
                                        <div className="filter-container">
                                            <select
                                                className="filter-select"
                                                value={filterStatus}
                                                onChange={(e) => setFilterStatus(e.target.value)}
                                            >
                                                <option value="all">All Applicants</option>
                                                <option value="approved">Approved Applicants</option>
                                                <option value="interview-completed">Completed Interviews</option>
                                                <option value="interview-scheduled">Interview Scheduled</option>
                                                <option value="physical-interview-scheduled">Physical Interview Scheduled</option>
                                                <option value="interview-abandoned">Interview Abandoned</option>
                                                <option value="accepted">Accepted Applicants</option>
                                                <option value="new">New Applicants</option>
                                                <option value="rejected">Rejected Applicants</option>
                                            </select>
                                        </div>

                                        <button
                                            id="rankApplicantsButton"
                                            className="rank-button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRankApplicants();
                                            }}
                                            style={{ position: 'relative', zIndex: 5 }}
                                        >
                                            <svg className="ai-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M12 15L8.5 10L15.5 10L12 15Z" fill="currentColor" />
                                                <path d="M7 5H17L21 9L12 20L3 9L7 5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M12 20V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M12 8V8.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                            </svg>
                                            {selectedJob.prompt ? "Rerank Applicants with AI" : "Rank Applicants with AI"}
                                        </button>

                                        <button className="upload-more-cv-button" onClick={handleUploadMoreCV}>
                                            Upload More CV
                                        </button>
                                    </div>
                                )}
                            </div>

                            {filteredApplicants.length === 0 ? (
                                <div className="no-applicants">
                                    <p>No applications have been received for this job yet.</p>
                                </div>
                            ) : (
                                <div className="applicants-list">
                                    {/* Ranking status title - new element */}
                                    <div className="ranking-status-container">
                                        {selectedJob.prompt ? (
                                            <>
                                                <h3 className="ranking-status ranked">
                                                    Ranked by: <span className="ranking-criteria">{selectedJob.prompt}</span>
                                                </h3>
                                                <button
                                                    className="rank-info-button"
                                                    onClick={handleRankInfoClick}
                                                    aria-label="View ranking criteria details"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <circle cx="12" cy="12" r="10"></circle>
                                                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                                                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                                    </svg>
                                                </button>
                                            </>
                                        ) : (
                                            <h3 className="ranking-status unranked">Unranked Applicants</h3>
                                        )}
                                    </div>

                                    {selectedJob.prompt ? (
                                        /* RANKED APPLICANTS: Display top 3 in podium arrangement */
                                        <>
                                            {filteredApplicants.length === 1 && (
                                                /* Single applicant layout - only middle position */
                                                <div
                                                    className={`flippable-card ${flippedCards[filteredApplicants[0].candidateId] ? 'flipped' : ''}`}
                                                    onClick={(e) => {
                                                        // Don't flip when clicking buttons
                                                        if (e.target.tagName !== 'BUTTON') {
                                                            toggleCardFlip(filteredApplicants[0].candidateId);
                                                        }
                                                        e.stopPropagation();
                                                    }}
                                                >
                                                    <div className="flipper">
                                                        <div className="front applicant-card">
                                                            <div className="applicant-rank-info">
                                                                <div className="rank-number">
                                                                    <span className="rank-circle">1</span>
                                                                </div>
                                                                <div className="applicant-info">
                                                                    <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                    <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[0])}</p>
                                                                </div>
                                                            </div>

                                                            <div className="applicant-status-actions">
                                                                <span className={`status-badge ${filteredApplicants[0].status || 'new'}`}>
                                                                    {filteredApplicants[0].status || 'new'}
                                                                </span>
                                                                <div className="rank-score-container">
                                                                    <span className="rank-score-label">Score: </span>
                                                                    <span className="rank-score-value">
                                                                        {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                            ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                            : "N/A"}
                                                                    </span>
                                                                </div>
                                                                <div className="button-container">
                                                                    {/* Show Interview Responses button BEFORE Full Profile if status is approved or interview completed */}
                                                                    {(filteredApplicants[0].status && (filteredApplicants[0].status.toLowerCase() === 'approved' || filteredApplicants[0].status.toLowerCase() === 'interview completed' || filteredApplicants[0].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                        <button
                                                                            className="view-responses-button"
                                                                            onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}/interview-responses`)}
                                                                        >
                                                                            Interview Responses
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="view-profile-button"
                                                                        onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}`)}
                                                                    >
                                                                        Full Profile
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="back applicant-card">
                                                            <div className="applicant-back-container">
                                                                <div className="applicant-rank-info">
                                                                    <div className="rank-number">
                                                                        <span className="rank-circle">1</span>
                                                                    </div>
                                                                    <div className="applicant-info" style={{ alignItems: 'flex-start' }}>
                                                                        <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                        <div className="rank-score-container">
                                                                            <span className="rank-score-label">Score: </span>
                                                                            <span className="rank-score-value">
                                                                                {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                                    ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                                    : "N/A"}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="reasoning-container">
                                                                    <p className="reasoning-text">
                                                                        {filteredApplicants[0].reasoning && filteredApplicants[0].reasoning.combined_reasoning
                                                                            ? filteredApplicants[0].reasoning.combined_reasoning
                                                                            : "No reasoning can be found for this applicant"}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {filteredApplicants.length >= 2 && (
                                                <div className="top-applicants-container">
                                                    <div className="top-three-applicants">
                                                        <div className="top-applicants-row-2">
                                                            {filteredApplicants.length === 2 ? (
                                                                /* Two applicants layout - position 1 and 2 */
                                                                <>
                                                                    {/* First applicant */}
                                                                    <div
                                                                        className={`flippable-card ${flippedCards[filteredApplicants[0].candidateId] ? 'flipped' : ''}`}
                                                                        data-rank="1"
                                                                        onClick={(e) => {
                                                                            // Don't flip when clicking buttons
                                                                            if (e.target.tagName !== 'BUTTON') {
                                                                                toggleCardFlip(filteredApplicants[0].candidateId);
                                                                            }
                                                                            e.stopPropagation();
                                                                        }}
                                                                        style={{ flex: '1' }}
                                                                    >
                                                                        <div className="flipper" style={{ flex: '1' }}>
                                                                            <div className="front applicant-card top-applicant-card" data-rank="1">
                                                                                <div className="rank-badge" data-rank="1">
                                                                                    <svg className="crown-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                                        <path d="M3 17L6 9L12 12L18 9L21 17H3Z" fill="#FFD700" />
                                                                                        <path d="M3 17L6 9L12 12L18 9L21 17M3.5 21H20.5M12 7C13.1046 7 14 6.10457 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 6.10457 10.8954 7 12 7Z"
                                                                                            stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                                    </svg>
                                                                                    1
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <div className="applicant-info">
                                                                                        <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                                        <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[0])}</p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <div className="applicant-status-actions-2">
                                                                                        <span className={`status-badge ${filteredApplicants[0].status || 'new'}`}>
                                                                                            {filteredApplicants[0].status || 'new'}
                                                                                        </span>
                                                                                        <div className="rank-score-container">
                                                                                            <span className="rank-score-label">Score: </span>
                                                                                            <span className="rank-score-value">
                                                                                                {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                                                    ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                                                    : "N/A"}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="button-container">
                                                                                            {(filteredApplicants[0].status && (filteredApplicants[0].status.toLowerCase() === 'approved' || filteredApplicants[0].status.toLowerCase() === 'interview completed' || filteredApplicants[0].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                                                <button
                                                                                                    className="view-responses-button"
                                                                                                    onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}/interview-responses`)}
                                                                                                >
                                                                                                    Interview Responses
                                                                                                </button>
                                                                                            )}
                                                                                            <button
                                                                                                className="view-profile-button"
                                                                                                onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}`)}
                                                                                            >
                                                                                                Full Profile
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="back applicant-card top-applicant-card" data-rank="1">
                                                                                <div className="rank-badge" data-rank="1">
                                                                                    <svg className="crown-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                                        <path d="M3 17L6 9L12 12L18 9L21 17H3Z" fill="#FFD700" />
                                                                                        <path d="M3 17L6 9L12 12L18 9L21 17M3.5 21H20.5M12 7C13.1046 7 14 6.10457 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 6.10457 10.8954 7 12 7Z"
                                                                                            stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                                    </svg>
                                                                                    1
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                                    <div>
                                                                                        <span className="rank-score-label">Score: </span>
                                                                                        <span className="rank-score-value">
                                                                                            {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                                                ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                                                : "N/A"}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>

                                                                                <p>
                                                                                    {filteredApplicants[0].reasoning && filteredApplicants[0].reasoning.combined_reasoning
                                                                                        ? filteredApplicants[0].reasoning.combined_reasoning
                                                                                        : "No reasoning can be found for this applicant"}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Second applicant */}
                                                                    <div
                                                                        className={`flippable-card ${flippedCards[filteredApplicants[1].candidateId] ? 'flipped' : ''}`}
                                                                        data-rank="2"
                                                                        mode="1"
                                                                        onClick={(e) => {
                                                                            // Don't flip when clicking buttons
                                                                            if (e.target.tagName !== 'BUTTON') {
                                                                                toggleCardFlip(filteredApplicants[1].candidateId);
                                                                            }
                                                                            e.stopPropagation();
                                                                        }}
                                                                        style={{ flex: '1' }}
                                                                    >
                                                                        <div className="flipper" style={{ flex: '1' }}>
                                                                            <div className="front applicant-card top-applicant-card" data-rank="2" mode="1">
                                                                                <div className="rank-badge" data-rank="2" style={{ marginTop: "2rem", marginBottom: "1.5rem" }}>
                                                                                    2
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <div className="applicant-info">
                                                                                        <h4>{renderApplicantID(filteredApplicants[1])}</h4>
                                                                                        <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[1])}</p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <div className="applicant-status-actions-2" style={{ marginTop: "10px" }}>
                                                                                        <span className={`status-badge ${filteredApplicants[1].status || 'new'}`}>
                                                                                            {filteredApplicants[1].status || 'new'}
                                                                                        </span>
                                                                                        <div className="rank-score-container">
                                                                                            <span className="rank-score-label">Score: </span>
                                                                                            <span className="rank-score-value">
                                                                                                {filteredApplicants[1].rank_score && filteredApplicants[1].rank_score.final_score
                                                                                                    ? filteredApplicants[1].rank_score.final_score.toFixed(2)
                                                                                                    : "N/A"}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="button-container" style={{ marginTop: "25px" }}>
                                                                                            {(filteredApplicants[1].status && (filteredApplicants[1].status.toLowerCase() === 'approved' || filteredApplicants[1].status.toLowerCase() === 'interview completed' || filteredApplicants[1].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                                                <button
                                                                                                    className="view-responses-button"
                                                                                                    onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[1].candidateId}/interview-responses`)}
                                                                                                >
                                                                                                    Interview Responses
                                                                                                </button>
                                                                                            )}
                                                                                            <button
                                                                                                className="view-profile-button"
                                                                                                onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[1].candidateId}`)}
                                                                                            >
                                                                                                Full Profile
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="back applicant-card top-applicant-card" data-rank="2" mode="1">
                                                                                <div className="rank-badge" data-rank="2">
                                                                                    2
                                                                                </div>
                                                                                <div className="applicant-content-container">
                                                                                    <h4>{renderApplicantID(filteredApplicants[1])}</h4>
                                                                                    <div>
                                                                                        <span className="rank-score-label">Score: </span>
                                                                                        <span className="rank-score-value">
                                                                                            {filteredApplicants[1].rank_score && filteredApplicants[1].rank_score.final_score
                                                                                                ? filteredApplicants[1].rank_score.final_score.toFixed(2)
                                                                                                : "N/A"}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>

                                                                                <p>
                                                                                    {filteredApplicants[1].reasoning && filteredApplicants[1].reasoning.combined_reasoning
                                                                                        ? filteredApplicants[1].reasoning.combined_reasoning
                                                                                        : "No reasoning can be found for this applicant"}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                /* Three or more applicants - show top 3 in podium layout */
                                                                <>
                                                                    <div className="top-applicants-row">
                                                                        {/* Second applicant - displayed on the left */}
                                                                        <div
                                                                            className={`flippable-card ${flippedCards[filteredApplicants[1].candidateId] ? 'flipped' : ''}`}
                                                                            data-rank="2"
                                                                            onClick={(e) => {
                                                                                // Don't flip when clicking buttons
                                                                                if (e.target.tagName !== 'BUTTON') {
                                                                                    toggleCardFlip(filteredApplicants[1].candidateId);
                                                                                }
                                                                                e.stopPropagation();
                                                                            }}
                                                                            style={{ flex: '1' }}
                                                                        >
                                                                            <div className="flipper" style={{ flex: '1' }}>
                                                                                <div className="front applicant-card top-applicant-card" data-rank="2">
                                                                                    <div className="rank-badge" data-rank="2">
                                                                                        2
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-info">
                                                                                            <h4>{renderApplicantID(filteredApplicants[1])}</h4>
                                                                                            <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[1])}</p>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-status-actions-2">
                                                                                            <span className={`status-badge ${filteredApplicants[1].status || 'new'}`}>
                                                                                                {filteredApplicants[1].status || 'new'}
                                                                                            </span>
                                                                                            <div className="rank-score-container">
                                                                                                <span className="rank-score-label">Score: </span>
                                                                                                <span className="rank-score-value">
                                                                                                    {filteredApplicants[1].rank_score && filteredApplicants[1].rank_score.final_score
                                                                                                        ? filteredApplicants[1].rank_score.final_score.toFixed(2)
                                                                                                        : "N/A"}
                                                                                                </span>
                                                                                            </div>
                                                                                            <div className="button-container">
                                                                                                {(filteredApplicants[1].status && (filteredApplicants[1].status.toLowerCase() === 'approved' || filteredApplicants[1].status.toLowerCase() === 'interview completed' || filteredApplicants[1].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                                                    <button
                                                                                                        className="view-responses-button"
                                                                                                        onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[1].candidateId}/interview-responses`)}
                                                                                                    >
                                                                                                        Interview Responses
                                                                                                    </button>
                                                                                                )}
                                                                                                <button
                                                                                                    className="view-profile-button"
                                                                                                    onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[1].candidateId}`)}
                                                                                                >
                                                                                                    Full Profile
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>

                                                                                <div className="back applicant-card top-applicant-card" data-rank="2">
                                                                                    <div className="rank-badge" data-rank="2">
                                                                                        2
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <h4>{renderApplicantID(filteredApplicants[1])}</h4>
                                                                                        <div>
                                                                                            <span className="rank-score-label">Score: </span>
                                                                                            <span className="rank-score-value">
                                                                                                {filteredApplicants[1].rank_score && filteredApplicants[1].rank_score.final_score
                                                                                                    ? filteredApplicants[1].rank_score.final_score.toFixed(2)
                                                                                                    : "N/A"}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>

                                                                                    <p>
                                                                                        {filteredApplicants[1].reasoning && filteredApplicants[1].reasoning.combined_reasoning
                                                                                            ? filteredApplicants[1].reasoning.combined_reasoning
                                                                                            : "No reasoning can be found for this applicant"}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* First applicant - displayed in the center (taller) */}
                                                                        <div
                                                                            className={`flippable-card ${flippedCards[filteredApplicants[0].candidateId] ? 'flipped' : ''}`}
                                                                            data-rank="1"
                                                                            onClick={(e) => {
                                                                                // Don't flip when clicking buttons
                                                                                if (e.target.tagName !== 'BUTTON') {
                                                                                    toggleCardFlip(filteredApplicants[0].candidateId);
                                                                                }
                                                                                e.stopPropagation();
                                                                            }}
                                                                            style={{ flex: '1' }}
                                                                        >
                                                                            <div className="flipper" style={{ flex: '1' }}>
                                                                                <div className="front applicant-card top-applicant-card" data-rank="1" mode="1">
                                                                                    <div className="rank-badge" data-rank="1">
                                                                                        <svg className="crown-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                                            <path d="M3 17L6 9L12 12L18 9L21 17H3Z" fill="#FFD700" />
                                                                                            <path d="M3 17L6 9L12 12L18 9L21 17M3.5 21H20.5M12 7C13.1046 7 14 6.10457 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 6.10457 10.8954 7 12 7Z"
                                                                                                stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                                        </svg>
                                                                                        1
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-info">
                                                                                            <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                                            <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[0])}</p>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-status-actions-2">
                                                                                            <span className={`status-badge ${filteredApplicants[0].status || 'new'}`}>
                                                                                                {filteredApplicants[0].status || 'new'}
                                                                                            </span>
                                                                                            <div className="rank-score-container">
                                                                                                <span className="rank-score-label">Score: </span>
                                                                                                <span className="rank-score-value">
                                                                                                    {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                                                        ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                                                        : "N/A"}
                                                                                                </span>
                                                                                            </div>
                                                                                            <div className="button-container">
                                                                                                {(filteredApplicants[0].status && (filteredApplicants[0].status.toLowerCase() === 'approved' || filteredApplicants[0].status.toLowerCase() === 'interview completed' || filteredApplicants[0].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                                                    <button
                                                                                                        className="view-responses-button"
                                                                                                        onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}/interview-responses`)}
                                                                                                    >
                                                                                                        Interview Responses
                                                                                                    </button>
                                                                                                )}
                                                                                                <button
                                                                                                    className="view-profile-button"
                                                                                                    onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[0].candidateId}`)}
                                                                                                >
                                                                                                    Full Profile
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>

                                                                                <div className="back applicant-card top-applicant-card" data-rank="1" mode="1">
                                                                                    <div className="rank-badge" data-rank="1">
                                                                                        <svg className="crown-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                                                            <path d="M3 17L6 9L12 12L18 9L21 17H3Z" fill="#FFD700" />
                                                                                            <path d="M3 17L6 9L12 12L18 9L21 17M3.5 21H20.5M12 7C13.1046 7 14 6.10457 14 5C14 3.89543 13.1046 3 12 3C10.8954 3 10 3.89543 10 5C10 6.10457 10.8954 7 12 7Z"
                                                                                                stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                                                        </svg>
                                                                                        1
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <h4>{renderApplicantID(filteredApplicants[0])}</h4>
                                                                                        <div>
                                                                                            <span className="rank-score-label">Score: </span>
                                                                                            <span className="rank-score-value">
                                                                                                {filteredApplicants[0].rank_score && filteredApplicants[0].rank_score.final_score
                                                                                                    ? filteredApplicants[0].rank_score.final_score.toFixed(2)
                                                                                                    : "N/A"}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>

                                                                                    <p>
                                                                                        {filteredApplicants[0].reasoning && filteredApplicants[0].reasoning.combined_reasoning
                                                                                            ? filteredApplicants[0].reasoning.combined_reasoning
                                                                                            : "No reasoning can be found for this applicant"}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                        </div>

                                                                        {/* Third applicant - displayed on the right */}
                                                                        <div
                                                                            className={`flippable-card ${flippedCards[filteredApplicants[2].candidateId] ? 'flipped' : ''}`}
                                                                            data-rank="3"
                                                                            onClick={(e) => {
                                                                                // Don't flip when clicking buttons
                                                                                if (e.target.tagName !== 'BUTTON') {
                                                                                    toggleCardFlip(filteredApplicants[2].candidateId);
                                                                                }
                                                                                e.stopPropagation();
                                                                            }}
                                                                            style={{ flex: '1' }}
                                                                        >
                                                                            <div className="flipper" style={{ flex: '1' }}>
                                                                                <div className="front applicant-card top-applicant-card" data-rank="3">
                                                                                    <div className="rank-badge" data-rank="3">
                                                                                        3
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-info">
                                                                                            <h4>{renderApplicantID(filteredApplicants[2])}</h4>
                                                                                            <p className="applicant-email">{renderApplicantSubmitDate(filteredApplicants[2])}</p>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <div className="applicant-status-actions-2">
                                                                                            <span className={`status-badge ${filteredApplicants[2].status || 'new'}`}>
                                                                                                {filteredApplicants[2].status || 'new'}
                                                                                            </span>
                                                                                            <div className="rank-score-container">
                                                                                                <span className="rank-score-label">Score: </span>
                                                                                                <span className="rank-score-value">
                                                                                                    {filteredApplicants[2].rank_score && filteredApplicants[2].rank_score.final_score
                                                                                                        ? filteredApplicants[2].rank_score.final_score.toFixed(2)
                                                                                                        : "N/A"}
                                                                                                </span>
                                                                                            </div>
                                                                                            <div className="button-container">
                                                                                                {(filteredApplicants[2].status && (filteredApplicants[2].status.toLowerCase() === 'approved' || filteredApplicants[2].status.toLowerCase() === 'interview completed' || filteredApplicants[2].status.toLowerCase() === 'physical interview scheduled')) && (
                                                                                                    <button
                                                                                                        className="view-responses-button"
                                                                                                        onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[2].candidateId}/interview-responses`)}
                                                                                                    >
                                                                                                        Interview Responses
                                                                                                    </button>
                                                                                                )}
                                                                                                <button
                                                                                                    className="view-profile-button"
                                                                                                    onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${filteredApplicants[2].candidateId}`)}
                                                                                                >
                                                                                                    Full Profile
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>


                                                                                <div className="back applicant-card top-applicant-card" data-rank="3">
                                                                                    <div className="rank-badge" data-rank="3">
                                                                                        3
                                                                                    </div>
                                                                                    <div className="applicant-content-container">
                                                                                        <h4>{renderApplicantID(filteredApplicants[2])}</h4>
                                                                                        <div>
                                                                                            <span className="rank-score-label">Score: </span>
                                                                                            <span className="rank-score-value">
                                                                                                {filteredApplicants[2].rank_score && filteredApplicants[2].rank_score.final_score
                                                                                                    ? filteredApplicants[2].rank_score.final_score.toFixed(2)
                                                                                                    : "N/A"}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>

                                                                                    <p>
                                                                                        {filteredApplicants[2].reasoning && filteredApplicants[2].reasoning.combined_reasoning
                                                                                            ? filteredApplicants[2].reasoning.combined_reasoning
                                                                                            : "No reasoning can be found for this applicant"}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Remaining applicants (4th and beyond) for ranked jobs */}
                                            {filteredApplicants.length > 3 && filteredApplicants.slice(3).map((applicant, index) => (
                                                <div
                                                    key={applicant.candidateId || index}
                                                    className={`flippable-card ${flippedCards[applicant.candidateId] ? 'flipped' : ''}`}
                                                    onClick={(e) => {
                                                        // Don't flip when clicking buttons
                                                        if (e.target.tagName !== 'BUTTON') {
                                                            toggleCardFlip(applicant.candidateId);
                                                        }
                                                        e.stopPropagation();
                                                    }}
                                                >
                                                    <div className="flipper">
                                                        <div className="front applicant-card">
                                                            <div className="applicant-rank-info">
                                                                <div className="rank-number">
                                                                    <span className="rank-circle">{index + 4}</span>
                                                                </div>
                                                                <div className="applicant-info">
                                                                    <h4>{renderApplicantID(applicant)}</h4>
                                                                    <p className="applicant-email">{renderApplicantSubmitDate(applicant)}</p>
                                                                </div>
                                                            </div>

                                                            <div className="applicant-status-actions">
                                                                <span className={`status-badge ${applicant.status || 'new'}`}>
                                                                    {applicant.status || 'new'}
                                                                </span>
                                                                <div className="rank-score-container">
                                                                    <span className="rank-score-label">Score: </span>
                                                                    <span className="rank-score-value">
                                                                        {applicant.rank_score && applicant.rank_score.final_score
                                                                            ? applicant.rank_score.final_score.toFixed(2)
                                                                            : "N/A"}
                                                                    </span>
                                                                </div>
                                                                <div className="button-container">
                                                                    {/* Show Interview Responses button BEFORE Full Profile if status is approved or interview completed */}
                                                                    {(applicant.status && (applicant.status.toLowerCase() === 'approved' || applicant.status.toLowerCase() === 'interview completed' || applicant.status.toLowerCase() === 'physical interview scheduled')) && (
                                                                        <button
                                                                            className="view-responses-button"
                                                                            onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${applicant.candidateId}/interview-responses`)}
                                                                        >
                                                                            Interview Responses
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="view-profile-button"
                                                                        onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${applicant.candidateId}`)}
                                                                    >
                                                                        Full Profile
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="back applicant-card">
                                                            <div className="applicant-back-container">
                                                                <div className="applicant-rank-info">
                                                                    <div className="rank-number">
                                                                        <span className="rank-circle">{index + 4}</span>
                                                                    </div>
                                                                    <div className="applicant-info" style={{ alignItems: 'flex-start' }}>
                                                                        <h4>{renderApplicantID(applicant)}</h4>
                                                                        <div className="rank-score-container">
                                                                            <span className="rank-score-label">Score: </span>
                                                                            <span className="rank-score-value">
                                                                                {applicant.rank_score && applicant.rank_score.final_score
                                                                                    ? applicant.rank_score.final_score.toFixed(2)
                                                                                    : "N/A"}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <div className="reasoning-container">
                                                                    <p className="reasoning-text">
                                                                        {applicant.reasoning && applicant.reasoning.combined_reasoning
                                                                            ? applicant.reasoning.combined_reasoning
                                                                            : "No reasoning can be found for this applicant"}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    ) : (
                                        /* UNRANKED APPLICANTS: Display all applicants in sequential order */
                                        filteredApplicants.map((applicant, index) => (
                                            <div key={applicant.candidateId || index} className="applicant-card">
                                                <div className="applicant-rank-info">
                                                    <div className="rank-number">
                                                        <span className="rank-circle">{index + 1}</span>
                                                    </div>
                                                    <div className="applicant-info">
                                                        <h4>{renderApplicantID(applicant)}</h4>
                                                        <p className="applicant-email">{renderApplicantSubmitDate(applicant)}</p>
                                                    </div>
                                                </div>

                                                <div className="applicant-status-actions">
                                                    <span className={`status-badge ${applicant.status || 'new'}`}>
                                                        {applicant.status || 'new'}
                                                    </span>
                                                    <div className="rank-score-container">
                                                        <span className="rank-score-label">Score: </span>
                                                        <span className="rank-score-value">
                                                            {applicant.rank_score && applicant.rank_score.final_score
                                                                ? applicant.rank_score.final_score.toFixed(2)
                                                                : "N/A"}
                                                        </span>
                                                    </div>
                                                    <div className="button-container">
                                                        {/* Also fix the unranked applicants section for consistency */}
                                                        {(applicant.status && (applicant.status.toLowerCase() === 'approved' || applicant.status.toLowerCase() === 'interview completed' || applicant.status.toLowerCase() === 'physical interview scheduled')) && (
                                                            <button
                                                                className="view-responses-button"
                                                                onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${applicant.candidateId}/interview-responses`)}
                                                            >
                                                                Interview Responses
                                                            </button>
                                                        )}
                                                        <button
                                                            className="view-profile-button"
                                                            onClick={() => navigate(`/dashboard/${selectedJob.jobId}/${applicant.candidateId}`)}
                                                        >
                                                            Full Profile
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Improved applicant data rendering with fallbacks and debugging
const renderApplicantID = (applicant) => {
    // Directly return candidateId instead of name
    return applicant.candidateId || "ID Not Available";
};

const renderApplicantSubmitDate = (applicant) => {
    if (applicant.overwriteAt) {
        const dateObj = new Date(applicant.overwriteAt);
        if (!isNaN(dateObj.getTime()) && dateObj.getFullYear() > 1970) {
            return `CV Overwritten on ${formatDate(applicant.overwriteAt)}`;
        } else {
            return `CV Overwritten on ${applicant.overwriteAt}`; // Displays old format as-is
        }
    }

    let uploadDateSource = null;
    if (applicant.uploadedAt) {
        uploadDateSource = applicant.uploadedAt;
    } else if (applicant.applicationDate) {
        uploadDateSource = applicant.applicationDate;
    }

    if (uploadDateSource) {
        return `CV Uploaded on ${formatDate(uploadDateSource)}`;
    }

    return "Upload Date Not Available";
};
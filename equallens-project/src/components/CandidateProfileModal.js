import React, { useState, useEffect } from 'react';
import './pages/ApplicantDetails.css';
import './pageloading.css';
import './CandidateProfileModal.css';
import InfoTooltip from './InfoTooltip';
import './InfoTooltip.css';

// LoadingAnimation component for consistent loading UI
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

// Helper function to render HTML content with proper structure
const renderHTMLContentWithStructure = (content) => {
    if (!content) return null;

    const lines = content.split('\n');
    let title = lines[0] || '';
    const descriptionLines = lines.slice(1);
    
    // Extract date pattern [Month Year - Year] and put it on the right
    let displayTitle = title;
    let dateInfo = null;
    const datePattern = /\[(.*?)\]/g;
    const dateMatch = datePattern.exec(title);
    
    if (dateMatch) {
        // Only extract and display valid dates (not DNS or other placeholders)
        const extractedDate = dateMatch[1];
        if (extractedDate !== "DNS" && !extractedDate.includes("DNS")) {
            // Remove the date from the title text and store it separately
            displayTitle = title.replace(dateMatch[0], '').trim();
            dateInfo = extractedDate; // Extract date without brackets
        } else {
            // If it's a placeholder, just remove it from display
            displayTitle = title.replace(dateMatch[0], '').trim();
        }
    }
    
    // Function to determine if a line is likely a new education-specific point
    const isEducationPoint = (line) => {
        // Check for grade/GPA patterns
        if (/CGPA|GPA|Grade|Result|Score|[0-9]\.[0-9]/.test(line)) return true;
        return false;
    };
    
    // Function to determine if a line is likely a new point or distinct item
    const isNewPoint = (line) => {
        // Check for common bullet point indicators
        if (/^\s*[-•*]\s/.test(line)) return true; // Starts with -, •, or *
        if (/^\s*\d+[.)]\s/.test(line)) return true; // Starts with number followed by . or )
        
        // Check for capitalization patterns that suggest new points
        if (/^\s*[A-Z][^.!?]*(?::|-)/.test(line)) return true; // Starts with capital and has : or -
        
        // Detect keywords that often start new points in resumes
        const pointKeywords = ['achieved', 'developed', 'created', 'managed', 'led', 'implemented', 
                              'designed', 'responsible', 'skills', 'specialized', 'worked', 'built'];
        const startsWithKeyword = new RegExp(`^\\s*(${pointKeywords.join('|')})\\b`, 'i');
        if (startsWithKeyword.test(line)) return true;
        
        return false;
    };
    
    // Group description lines into paragraphs or bullet points
    const groupedDescriptions = [];
    let currentGroup = '';
    
    // Determine if this is an education entry by checking the title
    const isEducation = title.toLowerCase().includes('degree') || 
                       title.toLowerCase().includes('education') || 
                       title.toLowerCase().includes('university') ||
                       title.toLowerCase().includes('college') ||
                       title.toLowerCase().includes('school');
    
    descriptionLines.forEach((line, i) => {
        line = line.trim();
        if (!line) return; // Skip empty lines
        
        // For education entries, treat CGPA and results lines as separate items
        if (isEducation && isEducationPoint(line)) {
            // If there's content already in currentGroup, add it to groupedDescriptions
            if (currentGroup) {
                groupedDescriptions.push(currentGroup.trim());
            }
            // Add the education specific line as its own group
            groupedDescriptions.push(line);
            currentGroup = '';
        }
        else if (i === 0 || isNewPoint(line)) {
            // If this is a new point or the first line, start a new group
            if (currentGroup) {
                groupedDescriptions.push(currentGroup.trim());
            }
            currentGroup = line;
        } else {
            // Continue the current paragraph with proper spacing
            currentGroup += ' ' + line;
        }
    });
    
    // Add the final group if it exists
    if (currentGroup) {
        groupedDescriptions.push(currentGroup.trim());
    }

    return (
        <div>
            {displayTitle && (
                <div className="title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <span dangerouslySetInnerHTML={{ __html: displayTitle }} />
                    {dateInfo && <span style={{fontWeight: 'normal'}}>[{dateInfo}]</span>}
                </div>
            )}
            {groupedDescriptions.map((para, index) => (
                <div key={index} className="description">
                    <span dangerouslySetInnerHTML={{ __html: para }} />
                </div>
            ))}
        </div>
    );
};

// Helper function to render HTML content with new lines
const renderHTMLContent = (content) => {
    if (!content) return null;
    
    return <div dangerouslySetInnerHTML={{ __html: content }} />;
};

// Helper function to sort and filter items based on relevance
const sortItemsByRelevance = (items, relevanceData) => {
    if (!relevanceData || !Array.isArray(items)) {
        return items || [];
    }
    
    // Create a map of item to relevance data
    const relevanceMap = {};
    relevanceData.forEach(data => {
        if (data.item) {
            relevanceMap[data.item] = {
                relevance: data.relevance || 0,
                relevant: data.relevant || false
            };
        }
    });
    
    // Map items to include relevance data
    return items
        .map(item => {
            // For string items (like skills)
            if (typeof item === 'string') {
                return {
                    content: item,
                    relevance: relevanceMap[item]?.relevance || 0,
                    relevant: relevanceMap[item]?.relevant || false
                };
            } 
            // For structured items (like education or experience entries)
            else {
                // Extract the first line as a key for matching
                const firstLine = item.split('\n')[0];
                return {
                    content: item, 
                    relevance: relevanceMap[firstLine]?.relevance || 0,
                    relevant: relevanceMap[firstLine]?.relevant || false
                };
            }
        })
        .sort((a, b) => b.relevance - a.relevance);
};

const CandidateProfileModal = ({ candidateId, isOpen, onClose }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [applicant, setApplicant] = useState(null);
    const [detail, setDetail] = useState(null);
    const [activeTab, setActiveTab] = useState('summary');

    useEffect(() => {
        if (!isOpen || !candidateId) return;

        const fetchCandidateData = async () => {
            setIsLoading(true);
            setError(null);

            try {
                // First get basic candidate info
                const candidateResponse = await fetch(`http://localhost:8000/api/candidates/candidate/${candidateId}`);
                
                if (!candidateResponse.ok) {
                    throw new Error(`Failed to fetch candidate data: ${candidateResponse.status}`);
                }
                
                const candidateData = await candidateResponse.json();
                setApplicant(candidateData);

                // Check if the candidate has detailed profile already
                if (!candidateData.detailed_profile || candidateData.detailed_profile === "") {
                    // Generate detailed profile if it doesn't exist
                    const detailResponse = await fetch(`http://localhost:8000/api/candidates/detail/${candidateId}`);
                    
                    if (!detailResponse.ok) {
                        throw new Error(`Failed to generate detailed profile: ${detailResponse.status}`);
                    }
                    
                    const detailData = await detailResponse.json();
                    setDetail(detailData);
                } else {
                    // Use existing detailed profile
                    setDetail({ detailed_profile: candidateData.detailed_profile });
                }
            } catch (err) {
                console.error("Error fetching candidate profile:", err);
                setError(err.message || "Failed to load candidate profile");
            } finally {
                setIsLoading(false);
            }
        };

        fetchCandidateData();
    }, [candidateId, isOpen]);

    if (!isOpen) return null;
    
    // Get the relevance analysis data if available
    const relevanceAnalysis = detail?.detailed_profile?.relevance_analysis || {};
    
    // Process skills data with relevance if available
    const softSkills = relevanceAnalysis.soft_skills 
        ? sortItemsByRelevance(
            [...(detail?.detailed_profile?.soft_skills || []), 
             ...(detail?.detailed_profile?.inferred_soft_skills || [])],
            relevanceAnalysis.soft_skills
          )
        : [...(detail?.detailed_profile?.soft_skills || []), 
           ...(detail?.detailed_profile?.inferred_soft_skills || [])].map(skill => ({ content: skill }));
        
    const technicalSkills = relevanceAnalysis.technical_skills 
        ? sortItemsByRelevance(
            [...(detail?.detailed_profile?.technical_skills || []), 
             ...(detail?.detailed_profile?.inferred_technical_skills || [])],
            relevanceAnalysis.technical_skills
          )
        : [...(detail?.detailed_profile?.technical_skills || []), 
           ...(detail?.detailed_profile?.inferred_technical_skills || [])].map(skill => ({ content: skill }));
            
    const languages = relevanceAnalysis.languages 
        ? sortItemsByRelevance(
            [...(detail?.detailed_profile?.languages || []), 
             ...(detail?.detailed_profile?.inferred_languages || [])],
            relevanceAnalysis.languages
          )
        : [...(detail?.detailed_profile?.languages || []), 
           ...(detail?.detailed_profile?.inferred_languages || [])].map(lang => ({ content: lang }));
    
    // Process education data with relevance if available
    const education = relevanceAnalysis.education 
        ? sortItemsByRelevance(detail?.detailed_profile?.education || [], relevanceAnalysis.education)
        : (detail?.detailed_profile?.education || []).map(item => ({ content: item }));
        
    const certifications = relevanceAnalysis.certifications 
        ? sortItemsByRelevance(detail?.detailed_profile?.certifications || [], relevanceAnalysis.certifications)
        : (detail?.detailed_profile?.certifications || []).map(item => ({ content: item }));
        
    const awards = relevanceAnalysis.awards 
        ? sortItemsByRelevance(detail?.detailed_profile?.awards || [], relevanceAnalysis.awards)
        : (detail?.detailed_profile?.awards || []).map(item => ({ content: item }));
    
    // Process experience data with relevance if available  
    const workExperience = relevanceAnalysis.work_experience 
        ? sortItemsByRelevance(detail?.detailed_profile?.work_experience || [], relevanceAnalysis.work_experience)
        : (detail?.detailed_profile?.work_experience || []).map(item => ({ content: item }));
        
    const projects = relevanceAnalysis.projects 
        ? sortItemsByRelevance(detail?.detailed_profile?.projects || [], relevanceAnalysis.projects)
        : (detail?.detailed_profile?.projects || []).map(item => ({ content: item }));
        
    const coCurricular = relevanceAnalysis.co_curricular_activities 
        ? sortItemsByRelevance(detail?.detailed_profile?.co_curricular_activities || [], relevanceAnalysis.co_curricular_activities)
        : (detail?.detailed_profile?.co_curricular_activities || []).map(item => ({ content: item }));
    
    // Check if any items are relevant in each section to display legend
    const hasRelevantSkills = softSkills.some(s => s.relevant) || 
                             technicalSkills.some(s => s.relevant) || 
                             languages.some(s => s.relevant);
                             
    const hasRelevantEducation = education.some(e => e.relevant) || 
                                certifications.some(c => c.relevant) || 
                                awards.some(a => a.relevant);
                                
    const hasRelevantExperience = workExperience.some(w => w.relevant) || 
                                 projects.some(p => p.relevant) || 
                                 coCurricular.some(c => c.relevant);

    return (
        <div className="candidate-modal-overlay" onClick={onClose}>
            <div className="candidate-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="candidate-modal-header">
                    <h2 className="candidate-modal-title">Candidate Profile</h2>
                    <button className="candidate-modal-close" onClick={onClose}>×</button>
                </div>

                <div className="candidate-modal-body">
                    {isLoading ? (
                        <div className="modal-loading-container">
                            <LoadingAnimation />
                            <p>Loading candidate profile...</p>
                        </div>
                    ) : error ? (
                        <div className="modal-error-container">
                            <div className="error-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="15" y1="9" x2="9" y2="15"></line>
                                    <line x1="9" y1="9" x2="15" y2="15"></line>
                                </svg>
                            </div>
                            <h3>Error Loading Profile</h3>
                            <p>{error}</p>
                            <button onClick={onClose}>Close</button>
                        </div>
                    ) : applicant && detail ? (
                        <div className="candidate-profile-content">
                            {/* Basic Info - Always visible */}
                            <div className="candidate-basic-info">
                                <h3>Candidate ID: {applicant.candidateId}</h3>
                                {applicant.status && (
                                    <div className="applicant-status-badge">
                                        <span className={`status-badge ${applicant.status.toLowerCase()}`}>{applicant.status}</span>
                                    </div>
                                )}
                            </div>

                            {/* Navigation Tabs */}
                            <div className="profile-tabs">
                                <button 
                                    className={`profile-tab ${activeTab === 'summary' ? 'active' : ''}`} 
                                    onClick={() => setActiveTab('summary')}
                                >
                                    Summary
                                </button>
                                <button 
                                    className={`profile-tab ${activeTab === 'skills' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('skills')}
                                >
                                    Skills
                                </button>
                                <button 
                                    className={`profile-tab ${activeTab === 'education' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('education')}
                                >
                                    Education
                                </button>
                                <button 
                                    className={`profile-tab ${activeTab === 'experience' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('experience')}
                                >
                                    Experience
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="profile-tab-content">
                                {/* Summary Tab */}
                                {activeTab === 'summary' && (
                                    <div className="tab-pane">
                                        {detail.detailed_profile.summary && (
                                            <div className="profile-section">
                                                <h4>Summary</h4>
                                                <div className="experience-container">
                                                    <div className="experience-card">
                                                        {renderHTMLContent(detail.detailed_profile.summary)}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Skills Tab */}
                                {activeTab === 'skills' && (
                                    <div className="tab-pane">
                                        {/* Relevance legend - moved to very top with improved positioning */}
                                        {hasRelevantSkills && (
                                            <div className="relevance-legend">
                                                <span className="relevance-legend-icon">⭐</span>
                                                <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                                            </div>
                                        )}
                                        
                                        <div className="profile-section">
                                            <h4>Skills Overview</h4>
                                            
                                            {/* Soft Skills */}
                                            {softSkills.length > 0 && (
                                                <div className="skills-group">
                                                    <div className="skills-group-header">
                                                        <p className="info-label">Soft Skills:</p>
                                                        {detail.detailed_profile.inferred_soft_skills && detail.detailed_profile.inferred_soft_skills.length > 0 && (
                                                            <InfoTooltip />
                                                        )}
                                                    </div>
                                                    <div className="skills-display">
                                                        {softSkills.map((skill, index) => {
                                                            const isInferred = detail.detailed_profile.inferred_soft_skills && 
                                                                detail.detailed_profile.inferred_soft_skills.includes(skill.content);
                                                            return (
                                                                <span key={`soft-${index}`} 
                                                                    className={`skill-tag ${isInferred ? 'inferred' : ''} ${skill.relevant ? 'relevant' : ''}`}>
                                                                    {skill.relevant && <span className="relevance-star">⭐ </span>}
                                                                    {skill.content}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Technical Skills */}
                                            {technicalSkills.length > 0 && (
                                                <div className="skills-group">
                                                    <div className="skills-group-header">
                                                        <p className="info-label">Technical Skills:</p>
                                                        {detail.detailed_profile.inferred_technical_skills && detail.detailed_profile.inferred_technical_skills.length > 0 && (
                                                            <InfoTooltip />
                                                        )}
                                                    </div>
                                                    <div className="skills-display">
                                                        {technicalSkills.map((skill, index) => {
                                                            const isInferred = detail.detailed_profile.inferred_technical_skills && 
                                                                detail.detailed_profile.inferred_technical_skills.includes(skill.content);
                                                            return (
                                                                <span key={`tech-${index}`} 
                                                                    className={`skill-tag ${isInferred ? 'inferred' : ''} ${skill.relevant ? 'relevant' : ''}`}>
                                                                    {skill.relevant && <span className="relevance-star">⭐ </span>}
                                                                    {skill.content}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {/* Languages */}
                                            {languages.length > 0 && (
                                                <div className="skills-group">
                                                    <div className="skills-group-header">
                                                        <p className="info-label">Languages:</p>
                                                        {detail.detailed_profile.inferred_languages && detail.detailed_profile.inferred_languages.length > 0 && (
                                                            <InfoTooltip />
                                                        )}
                                                    </div>
                                                    <div className="skills-display">
                                                        {languages.map((language, index) => {
                                                            const isInferred = detail.detailed_profile.inferred_languages && 
                                                                detail.detailed_profile.inferred_languages.includes(language.content);
                                                            return (
                                                                <span key={`lang-${index}`} 
                                                                    className={`skill-tag ${isInferred ? 'inferred' : ''} ${language.relevant ? 'relevant' : ''}`}>
                                                                    {language.relevant && <span className="relevance-star">⭐ </span>}
                                                                    {language.content}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Education Tab */}
                                {activeTab === 'education' && (
                                    <div className="tab-pane">
                                        {/* Relevance legend - consistent positioning */}
                                        {hasRelevantEducation && (
                                            <div className="relevance-legend">
                                                <span className="relevance-legend-icon">⭐</span>
                                                <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                                            </div>
                                        )}
                                        
                                        {/* Education */}
                                        {education.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Education Level</h4>
                                                <div className="education-display">
                                                    {education.map((item, index) => (
                                                        <div key={index} className={`education-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Certifications */}
                                        {certifications.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Certifications</h4>
                                                <div className="education-display">
                                                    {certifications.map((item, index) => (
                                                        <div key={index} className={`education-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Awards */}
                                        {awards.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Awards & Achievements</h4>
                                                <div className="education-display">
                                                    {awards.map((item, index) => (
                                                        <div key={index} className={`education-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Experience Tab */}
                                {activeTab === 'experience' && (
                                    <div className="tab-pane">
                                        {/* Relevance legend - consistent positioning */}
                                        {hasRelevantExperience && (
                                            <div className="relevance-legend">
                                                <span className="relevance-legend-icon">⭐</span>
                                                <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                                            </div>
                                        )}
                                        
                                        {/* Work Experience */}
                                        {workExperience.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Work Experience</h4>
                                                <div className="experience-display">
                                                    {workExperience.map((item, index) => (
                                                        <div key={index} className={`experience-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Projects */}
                                        {projects.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Projects</h4>
                                                <div className="projects-display">
                                                    {projects.map((item, index) => (
                                                        <div key={index} className={`project-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Co-curricular Activities */}
                                        {coCurricular.length > 0 && (
                                            <div className="profile-section">
                                                <h4>Co-curricular Activities</h4>
                                                <div className="activities-display">
                                                    {coCurricular.map((item, index) => (
                                                        <div key={index} className={`activity-tag ${item.relevant ? 'relevant' : ''}`}>
                                                            {item.relevant && <span className="relevance-star">⭐ </span>}
                                                            {renderHTMLContentWithStructure(item.content)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="modal-error-container">
                            <p>No candidate data available</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CandidateProfileModal;

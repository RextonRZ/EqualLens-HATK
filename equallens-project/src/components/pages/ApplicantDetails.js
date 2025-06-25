import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import RankCriteriaContent from '../RankCriteriaContent';
import './ApplicantDetails.css';
import './Dashboard.css';
import '../pageloading.css'; // Import the loading animation CSS
import InfoTooltip from '../InfoTooltip';
import '../InfoTooltip.css';
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip } from 'recharts';
import ScoringStandardModal from '../ScoringStandardModal';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Chart } from 'chart.js';
import DetailedScoringModal from '../DetailedScoringModal';
import InferredSkillModal from '../InferredSkillModal'; // Added: Import the new modal

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

// Helper function to render HTML content with new lines
const renderHTMLContent = (content) => {
    if (!content) return null;
    const formattedContent = content.split('\n').map((line, index) => (
        <React.Fragment key={index}>
            {index > 0 && <br />}
            <span dangerouslySetInnerHTML={{ __html: line }} />
        </React.Fragment>
    ));
    return formattedContent;
};

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
                <div className="title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span dangerouslySetInnerHTML={{ __html: displayTitle }} />
                    {dateInfo && <span style={{ fontWeight: 'normal' }}>[{dateInfo}]</span>}
                </div>
            )}
            {groupedDescriptions.map((para, index) => (
                <div key={index} className="description">
                    {para}
                </div>
            ))}
        </div>
    );
};

// Helper function to sort and filter items based on relevance
const sortItemsByRelevance = (items, relevanceData) => {
    if (!relevanceData || !Array.isArray(relevanceData)) { // Check if relevanceData itself is an array
        // If items is already structured, just sort by existing relevance or default to 0
        if (items && Array.isArray(items) && items.every(item => typeof item === 'object' && 'content' in item)) {
            return items.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
        }
        // If items are simple strings or other, map them to the default structure
        return (items || []).map(item => ({
            content: typeof item === 'object' && item !== null && 'content' in item ? item.content : String(item),
            inferred: typeof item === 'object' && item !== null && 'inferred' in item ? item.inferred : false,
            relevance: 0,
            relevant: false
        }));
    }

    const relevanceMap = {};
    relevanceData.forEach(data => {
        if (data.item) { // Assuming relevanceData items have an "item" string key that matches skillObj.content
            relevanceMap[data.item] = {
                relevance: data.relevance || 0,
                relevant: data.relevant || false
            };
        }
    });

    return items
        .map(itemObj => { // Expects items to be like [{content: "SkillA", inferred: false}, {content: "SkillB", inferred: true}]
            const contentKey = typeof itemObj === 'object' && itemObj !== null && typeof itemObj.content === 'string' ? itemObj.content : String(itemObj);
            const mappedRelevance = relevanceMap[contentKey] || { relevance: 0, relevant: false };

            return {
                content: contentKey,
                inferred: typeof itemObj === 'object' && itemObj !== null ? itemObj.inferred : false, // Preserve inferred status
                relevance: mappedRelevance.relevance,
                relevant: mappedRelevance.relevant
            };
        })
        .sort((a, b) => b.relevance - a.relevance);
};

const EmptyStateMessage = ({ type, icon }) => (
    <div className="empty-state-container">
        <div className="empty-state-content">
            <div className="empty-state-icon">{icon}</div>
            <h3 className="empty-state-title">No {type} Information Available</h3>
            <p className="empty-state-description">
                This candidate's resume doesn't contain any {type.toLowerCase()} information.
            </p>
        </div>
    </div>
);

// Render Skills Tab Content with relevance indicators and debugging
const SkillsTabContent = ({ detail, handleRegenerateProfile, onOpenInferredSkillModal }) => {
    const relevanceAnalysis = detail?.detailed_profile?.relevance_analysis || {};

    const combinedSoftSkills = [
        ...(detail?.detailed_profile?.soft_skills || []).map(s => ({ content: s, inferred: false })),
        ...(detail?.detailed_profile?.inferred_soft_skills || []).map(s => ({ content: s, inferred: true }))
    ];
    const softSkills = sortItemsByRelevance(combinedSoftSkills, relevanceAnalysis.soft_skills);

    const combinedTechnicalSkills = [
        ...(detail?.detailed_profile?.technical_skills || []).map(s => ({ content: s, inferred: false })),
        ...(detail?.detailed_profile?.inferred_technical_skills || []).map(s => ({ content: s, inferred: true }))
    ];
    const technicalSkills = sortItemsByRelevance(combinedTechnicalSkills, relevanceAnalysis.technical_skills);

    const combinedLanguages = [
        ...(detail?.detailed_profile?.languages || []).map(s => ({ content: s, inferred: false })),
        ...(detail?.detailed_profile?.inferred_languages || []).map(s => ({ content: s, inferred: true }))
    ];
    const languages = sortItemsByRelevance(combinedLanguages, relevanceAnalysis.languages);

    const hasRelevantItems = softSkills.some(s => s.relevant) ||
        technicalSkills.some(s => s.relevant) ||
        languages.some(s => s.relevant);

    const hasNoSkills = softSkills.length === 0 && technicalSkills.length === 0 && languages.length === 0;

    if (hasNoSkills) {
        return (
            <EmptyStateMessage 
                type="Skills" 
                icon="🔧"
            />
        );
    }

    return (
        <div className="applicant-info-container">
            <div className="applicant-info">
                {hasRelevantItems && (
                    <div className="relevance-legend">
                        <span className="relevance-legend-icon">⭐</span>
                        <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                    </div>
                )}
                {/* REMOVED InferredSkillModal rendering from here */}

                {/* Soft Skills */}
                {softSkills.length > 0 && (
                    <div className="info-group" style={{ marginBottom: "10px" }}>
                        <div className="skills-group-header">
                            <p className="info-label">Soft Skills:</p>
                            {(detail.detailed_profile.inferred_soft_skills && detail.detailed_profile.inferred_soft_skills.length > 0) && (
                                <InfoTooltip
                                    text="AI-inferred skills based on resume context. Click an inferred skill (marked with i) for its specific justification."
                                />
                            )}
                        </div>
                        <div className="skills-display">
                            {softSkills.map((skillObj, index) => {
                                const skillName = skillObj.content;
                                const categoryKey = 'soft_skills';
                                const uiCategoryTitle = 'Inferred Soft Skill Justification';
                                const explanationExists = detail?.detailed_profile?.inferred_skills_explanations?.[categoryKey]?.[skillName];
                                const isInteractive = skillObj.inferred && explanationExists;

                                return (
                                    <span
                                        key={`soft-${index}`}
                                        className={`skill-tag ${skillObj.inferred ? 'inferred' : ''} ${skillObj.relevant ? 'relevant' : ''} ${isInteractive ? 'interactive-inferred' : ''}`}
                                        onClick={isInteractive ? () => onOpenInferredSkillModal(skillName, categoryKey, uiCategoryTitle) : undefined}
                                        style={isInteractive ? { cursor: 'pointer' } : {}}
                                        title={isInteractive ? `Click to see justification for '${skillName}'` : undefined}
                                    >
                                        {skillObj.relevant && <span className="relevance-star">⭐ </span>}
                                        {skillName}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Technical Skills */}
                {technicalSkills.length > 0 && (
                    <div className="info-group" style={{ marginBottom: "10px" }}>
                        <div className="skills-group-header">
                            <p className="info-label">Technical Skills:</p>
                            {(detail.detailed_profile.inferred_technical_skills && detail.detailed_profile.inferred_technical_skills.length > 0) && (
                                <InfoTooltip
                                    text="AI-inferred skills based on resume context. Click an inferred skill (marked with i) for its specific justification."
                                />
                            )}
                        </div>
                        <div className="skills-display">
                            {technicalSkills.map((skillObj, index) => {
                                const skillName = skillObj.content;
                                const categoryKey = 'technical_skills';
                                const uiCategoryTitle = 'Inferred Technical Skill Justification';
                                const explanationExists = detail?.detailed_profile?.inferred_skills_explanations?.[categoryKey]?.[skillName];
                                const isInteractive = skillObj.inferred && explanationExists;
                                return (
                                    <span
                                        key={`tech-${index}`}
                                        className={`skill-tag ${skillObj.inferred ? 'inferred' : ''} ${skillObj.relevant ? 'relevant' : ''} ${isInteractive ? 'interactive-inferred' : ''}`}
                                        onClick={isInteractive ? () => onOpenInferredSkillModal(skillName, categoryKey, uiCategoryTitle) : undefined}
                                        style={isInteractive ? { cursor: 'pointer' } : {}}
                                        title={isInteractive ? `Click to see justification for '${skillName}'` : undefined}
                                    >
                                        {skillObj.relevant && <span className="relevance-star">⭐ </span>}
                                        {skillName}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Languages */}
                {languages.length > 0 && (
                    <div className="info-group" style={{ marginBottom: "10px" }}>
                        <div className="skills-group-header">
                            <p className="info-label">Languages:</p>
                            {(detail.detailed_profile.inferred_languages && detail.detailed_profile.inferred_languages.length > 0) && (
                                <InfoTooltip
                                    text="AI-inferred languages based on resume context. Click an inferred language (marked with i) for its specific justification."
                                />
                            )}
                        </div>
                        <div className="skills-display">
                            {languages.map((skillObj, index) => {
                                const skillName = skillObj.content;
                                const categoryKey = 'languages';
                                const uiCategoryTitle = 'Inferred Language Justification';
                                const explanationExists = detail?.detailed_profile?.inferred_skills_explanations?.[categoryKey]?.[skillName];
                                const isInteractive = skillObj.inferred && explanationExists;
                                return (
                                    <span
                                        key={`lang-${index}`}
                                        className={`skill-tag ${skillObj.inferred ? 'inferred' : ''} ${skillObj.relevant ? 'relevant' : ''} ${isInteractive ? 'interactive-inferred' : ''}`}
                                        onClick={isInteractive ? () => onOpenInferredSkillModal(skillName, categoryKey, uiCategoryTitle) : undefined}
                                        style={isInteractive ? { cursor: 'pointer' } : {}}
                                        title={isInteractive ? `Click to see justification for '${skillName}'` : undefined}
                                    >
                                        {skillObj.relevant && <span className="relevance-star">⭐ </span>}
                                        {skillName}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// Education Tab Content with relevance indicators
const EducationTabContent = ({ detail }) => {
    const relevanceAnalysis = detail?.detailed_profile?.relevance_analysis || {};

    // Sort educational items by relevance
    const education = sortItemsByRelevance(
        detail.detailed_profile.education || [],
        relevanceAnalysis.education || []
    );

    const certifications = sortItemsByRelevance(
        detail.detailed_profile.certifications || [],
        relevanceAnalysis.certifications || []
    );

    const awards = sortItemsByRelevance(
        detail.detailed_profile.awards || [],
        relevanceAnalysis.awards || []
    );

    const hasNoEducation = education.length === 0 && certifications.length === 0 && awards.length === 0;

    if (hasNoEducation) {
        return (
            <EmptyStateMessage 
                type="Education" 
                icon="🎓"
            />
        );
    }

    // Check if any education items are relevant
    const hasRelevantItems = education.some(item => item.relevant) ||
        certifications.some(item => item.relevant) ||
        awards.some(item => item.relevant);

    return (
        <div className="applicant-info-container">
            <div className="applicant-info">
                {/* Relevance legend - only show if we have relevant items */}
                {hasRelevantItems && (
                    <div className="relevance-legend">
                        <span className="relevance-legend-icon">⭐</span>
                        <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                    </div>
                )}

                {/* Education Level */}
                {education.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Education Level:</p>
                        <ul className="education-display">
                            {education.map((item, index) => (
                                <li
                                    key={`edu-${index}`}
                                    className={`education-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Certifications */}
                {certifications.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Certifications:</p>
                        <ul className="education-display">
                            {certifications.map((item, index) => (
                                <li
                                    key={`cert-${index}`}
                                    className={`education-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Awards */}
                {awards.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Awards:</p>
                        <ul className="education-display">
                            {awards.map((item, index) => (
                                <li
                                    key={`award-${index}`}
                                    className={`education-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

// Experience Tab Content with relevance indicators
const ExperienceTabContent = ({ detail }) => {
    const relevanceAnalysis = detail?.detailed_profile?.relevance_analysis || {};

    // Sort experience items by relevance
    const workExperience = sortItemsByRelevance(
        detail.detailed_profile.work_experience || [],
        relevanceAnalysis.work_experience || []
    );

    const projects = sortItemsByRelevance(
        detail.detailed_profile.projects || [],
        relevanceAnalysis.projects || []
    );

    const coCurricular = sortItemsByRelevance(
        detail.detailed_profile.co_curricular_activities || [],
        relevanceAnalysis.co_curricular_activities || []
    );

    const hasNoExperience = workExperience.length === 0 && projects.length === 0 && coCurricular.length === 0;

    if (hasNoExperience) {
        return (
            <EmptyStateMessage 
                type="Experience" 
                icon="💼"
            />
        );
    }

    // Check if any experience items are relevant
    const hasRelevantItems = workExperience.some(item => item.relevant) ||
        projects.some(item => item.relevant) ||
        coCurricular.some(item => item.relevant);

    return (
        <div className="applicant-info-container">
            <div className="applicant-info">
                {/* Relevance legend - only show if we have relevant items */}
                {hasRelevantItems && (
                    <div className="relevance-legend">
                        <span className="relevance-legend-icon">⭐</span>
                        <span className="relevance-legend-text">Indicates high relevance to job requirements</span>
                    </div>
                )}

                {/* Work Experience */}
                {workExperience.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Work Experience:</p>
                        <ul className="experience-display">
                            {workExperience.map((item, index) => (
                                <li
                                    key={`work-${index}`}
                                    className={`experience-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Projects */}
                {projects.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Projects:</p>
                        <ul className="projects-display">
                            {projects.map((item, index) => (
                                <li
                                    key={`project-${index}`}
                                    className={`project-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Co-curricular Activities */}
                {coCurricular.length > 0 && (
                    <div className="info-group">
                        <p className="info-label">Co-curricular Activities:</p>
                        <ul className="activities-display">
                            {coCurricular.map((item, index) => (
                                <li
                                    key={`activity-${index}`}
                                    className={`activity-tag ${item.relevant ? 'relevant' : ''}`}
                                >
                                    {item.relevant && <span className="relevance-star">⭐ </span>}
                                    {renderHTMLContentWithStructure(item.content)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

// Radar Chart component to display multi-criteria assessment
const ApplicantRadarChart = ({ applicant, job }) => {
    // Extract score data from applicant
    const scores = applicant?.rank_score || {};
    const selectedCriteria = job?.prompt || "";

    // Create data structure for radar chart - remove the *10 multiplier
    const allData = [
        { subject: 'Relevance', value: scores.relevance || 0, fullMark: 10, category: 'Skills' },
        { subject: 'Proficiency', value: scores.proficiency || 0, fullMark: 10, category: 'Skills' },
        { subject: 'Add. Skills', value: scores.additionalSkill || 0, fullMark: 10, category: 'Skills' },
        { subject: 'Job Exp', value: scores.jobExp || 0, fullMark: 10, category: 'Experience' },
        { subject: 'Projects', value: scores.projectCocurricularExp || 0, fullMark: 10, category: 'Experience' },
        { subject: 'Certifications', value: scores.certification || 0, fullMark: 10, category: 'Experience' },
        { subject: 'Study Level', value: scores.studyLevel || 0, fullMark: 10, category: 'Education' },
        { subject: 'Awards', value: scores.awards || 0, fullMark: 10, category: 'Education' },
        { subject: 'Coursework', value: scores.courseworkResearch || 0, fullMark: 10, category: 'Education' },
        { subject: 'Collaboration Style', value: scores.collaborationStyle || 0, fullMark: 10, category: 'Cultural Fit' },
        { subject: 'Growth Mindset', value: scores.growthMindset || 0, fullMark: 10, category: 'Cultural Fit' },
        { subject: 'Community Engagement', value: scores.communityEngagement || 0, fullMark: 10, category: 'Cultural Fit' },
    ];

    const filteredData = selectedCriteria && selectedCriteria.trim()
        ? allData.filter(item => selectedCriteria.includes(item.category))
        : []; // Use empty data if no criteria are selected

    const noCriteriaSelected = !selectedCriteria || !selectedCriteria.trim();

    const placeholderData = [
        { subject: 'Relevance', value: 0, fullMark: 10, category: 'Skills' },
        { subject: 'Proficiency', value: 0, fullMark: 10, category: 'Skills' },
        { subject: 'Add. Skills', value: 0, fullMark: 10, category: 'Skills' },
        { subject: 'Job Exp', value: 0, fullMark: 10, category: 'Experience' },
        { subject: 'Projects', value: 0, fullMark: 10, category: 'Experience' },
        { subject: 'Certifications', value: 0, fullMark: 10, category: 'Experience' },
        { subject: 'Study Level', value: 0, fullMark: 10, category: 'Education' },
        { subject: 'Awards', value: 0, fullMark: 10, category: 'Education' },
        { subject: 'Coursework', value: 0, fullMark: 10, category: 'Education' },
        { subject: 'Collaboration Style', value: 0, fullMark: 10, category: 'Cultural Fit' },
        { subject: 'Growth Mindset', value: 0, fullMark: 10, category: 'Cultural Fit' },
        { subject: 'Community Engagement', value: 0, fullMark: 10, category: 'Cultural Fit' }
    ];

    const dataToDisplay = noCriteriaSelected ? placeholderData : filteredData;

    // Calculate overall score using the same logic as in Dashboard.js
    const overallScore = applicant?.rank_score?.final_score
        ? parseFloat(applicant.rank_score.final_score.toFixed(2))
        : 0.00;

    // Category colors
    const categoryColors = {
        Skills: '#8250c8',
        Experience: '#dd20c1',
        Education: '#0066cc'
    };

    const [showRankCriteriaModal, setShowRankCriteriaModal] = useState(false);

    // Custom tooltip for radar chart
    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            let color = '#333';

            // Determine color based on category
            Object.entries(categoryColors).forEach(([category, categoryColor]) => {
                if (data.category === category) {
                    color = categoryColor;
                }
            });

            return (
                <div className="custom-tooltip" style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    padding: '10px',
                    border: `2px solid ${color}`,
                    borderRadius: '4px',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)'
                }}>
                    <p className="tooltip-subject" style={{
                        color: color,
                        fontWeight: 'bold',
                        margin: 0,
                        fontSize: '14px'
                    }}>{data.subject}</p>
                    <p className="tooltip-value" style={{
                        margin: '5px 0 0',
                        fontSize: '16px'
                    }}>{noCriteriaSelected ? "N/A" : `${data.value}/10`}</p>
                    <p className="tooltip-category" style={{
                        color: color,
                        margin: '5px 0 0',
                        fontSize: '12px',
                        opacity: 0.8
                    }}>Category: {data.category}</p>
                </div>
            );
        }

        return null;
    };

    return (
        <div className="radar-chart-container">
            <div className="radar-chart-header">
                <div className={`overall-score ${noCriteriaSelected ? 'unranked-overall-score' : ''}`}>
                    <span className="score-label">Overall Score:</span>
                    <span className="score-value">
                        {noCriteriaSelected ? "Unranked" : overallScore}
                    </span>
                    {!noCriteriaSelected && <span className="score-max">/ 100</span>}
                    {/* Add question mark button with hover text */}
                    <div className="info-circle-container">
                        <button
                            className="info-circle-button"
                            onClick={() => setShowRankCriteriaModal(true)}
                            aria-label="Show Ranking Criteria"
                        >
                            ?
                        </button>
                        <span className="info-hover-text">How it is evaluated</span>
                    </div>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={dataToDisplay}>
                    <PolarGrid stroke="#e5e7eb" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#4b5563', fontSize: 12, fontWeight: 500 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 10 }} /> {/* Changed domain to [0, 10] */}
                    <Radar
                        name="Candidate"
                        dataKey="value"
                        stroke={noCriteriaSelected ? "#ccc" : "#F9645F"}
                        fill={noCriteriaSelected ? "#ccc" : "#F9645F"}
                        fillOpacity={0.5}
                        activeDot={{
                            r: 6,
                            strokeWidth: 2,
                            stroke: 'white',
                            fill: ({ payload }) => {
                                return categoryColors[payload.category] || '#F9645F';
                            }
                        }}
                        animationBegin={0}
                        animationDuration={1200}
                        animationEasing="ease-out"
                    />
                    <Tooltip content={<CustomTooltip />} />
                </RadarChart>
            </ResponsiveContainer>
            {showRankCriteriaModal && (
                <div className="rank-criteria-modal-overlay">
                    <div className="rank-criteria-modal-content">
                        <RankCriteriaContent prompt={job?.prompt || ""} />
                        <button
                            className="close-modal-button"
                            onClick={() => setShowRankCriteriaModal(false)}
                            aria-label="Close Ranking Criteria Modal"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// Fetch applicants for a selected job from the backend API
const fetchApplicants = async (jobId) => {
    try {
        const response = await fetch(`http://localhost:8000/api/candidates/applicants?jobId=${jobId}`);
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.status}`);
        }
        const applicantsData = await response.json();
        // console.log("Fetched applicants data:", applicantsData);
        return applicantsData;
    } catch (err) {
        console.error("Error fetching applicants:", err);
        throw err; // re-throw to handle in calling function
    }
};

// Generate detailed information for a specific applicant from the backend API
const generateApplicantDetail = async (candidateId) => {
    try {
        const response = await fetch(`http://localhost:8000/api/candidates/detail/${candidateId}`);
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.status}`);
        }
        const applicantDetails = await response.json();
        // console.log("Generated applicant detail:", applicantDetails);
        return applicantDetails;
    } catch (err) {
        console.error("Error generating applicant details:", err);
        throw err; // re-throw to handle in calling function
    }
};

// Fetch the latest job data to ensure we have the most up-to-date information
const fetchJob = async (jobId) => {
    try {
        const jobResponse = await fetch(`http://localhost:8000/api/jobs/${jobId}`);
        if (!jobResponse.ok) {
            throw new Error(`Failed to fetch updated job data: ${jobResponse.status}`);
        }
        const updatedJobData = await jobResponse.json();
        // console.log("Fetched updated job data:", updatedJobData);
        return updatedJobData;
    } catch (err) {
        console.error("Error fetching job data:", err);
        throw err; // re-throw to handle in calling function
    }
};

const ScoreDetailModal = ({ isOpen, onClose, title, score, explanation, color }) => {
    if (!isOpen) return null;

    return (
        <div
            className="score-detail-modal-overlay"
            role="dialog"
            aria-modal="true"
            onClick={onClose} // Close modal when clicking outside
        >
            <div
                className="score-detail-modal-content"
                style={{ borderColor: color }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div className="score-detail-modal-header">
                    <h2 style={{ color }}>{title}</h2>
                    <button className="close-modal-button" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
                <div className="score-detail-modal-body">
                    <p><strong>Score:</strong> {score}/10</p>
                    <p><strong>Explanation:</strong></p>
                    <div className="explanation-content">{explanation || "No explanation provided."}</div>
                </div>
            </div>
        </div>
    );
};

const DetailedBreakdownModal = ({ job, applicant, setShowDetailedBreakdownModal }) => {
    const [activeTab, setActiveTab] = useState('skills');

    // Automatically set the active tab if only one or two tabs are available
    useEffect(() => {
        const tabs = [];
        if (job.prompt.includes("Skills")) tabs.push('skills');
        if (job.prompt.includes("Experience")) tabs.push('experience');
        if (job.prompt.includes("Education")) tabs.push('education');
        if (job.prompt.includes("Cultural Fit")) tabs.push('culturalFit');

        // Auto-select first tab when there are 1 or 2 criteria
        if (tabs.length === 1 || tabs.length === 2) {
            setActiveTab(tabs[0]);
        }
    }, [job.prompt]);

    return (
        <div
            className="detail-modal-overlay"
            role="dialog"
            aria-labelledby="detail-modal-title"
            aria-modal="true"
            onClick={() => setShowDetailedBreakdownModal(false)} // Close modal when clicking outside
        >
            <div
                className="detail-modal-content optimized-modal"
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <div className="detail-modal-header">
                    <h2 id="detail-modal-title" className="detail-modal-title">
                        Candidate Evaluation Details
                    </h2>
                    <button
                        className="detail-modal-close"
                        onClick={() => setShowDetailedBreakdownModal(false)}
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="detail-modal-tabs">
                    {job.prompt.includes("Skills") && (
                        <button
                            className={`detail-tab ${activeTab === 'skills' ? 'active' : ''}`}
                            onClick={() => setActiveTab('skills')}
                        >
                            Skills
                        </button>
                    )}
                    {job.prompt.includes("Experience") && (
                        <button
                            className={`detail-tab ${activeTab === 'experience' ? 'active' : ''}`}
                            onClick={() => setActiveTab('experience')}
                        >
                            Experience
                        </button>
                    )}
                    {job.prompt.includes("Education") && (
                        <button
                            className={`detail-tab ${activeTab === 'education' ? 'active' : ''}`}
                            onClick={() => setActiveTab('education')}
                        >
                            Education
                        </button>
                    )}
                    {job.prompt.includes("Cultural Fit") && (
                        <button
                            className={`detail-tab ${activeTab === 'culturalFit' ? 'active' : ''}`}
                            onClick={() => setActiveTab('culturalFit')}
                        >
                            Cultural Fit
                        </button>
                    )}
                </div>

                <div className="detail-modal-body optimized-body">
                    {/* Tab Content */}
                    {activeTab === 'skills' && job.prompt.includes("Skills") && (
                        <div className="tab-content scores-tab">
                            <h3 className="tab-title">Skills Evaluation</h3>
                            <div className="score-cards-grid">
                                {[{ key: 'relevance', title: 'Relevance to Job' },
                                { key: 'proficiency', title: 'Proficiency Level' },
                                { key: 'additionalSkill', title: 'Additional Skills' }
                                ].map((item) => {
                                    const score = applicant.rank_score?.[item.key] || 0;
                                    const reasoning = applicant.reasoning?.[item.key] || "No reasoning provided";

                                    return (
                                        <div key={item.key} className="score-card compact-card">
                                            <div className="score-header">
                                                <h4>{item.title}</h4>
                                                <div className="score-value">{score}/10</div>
                                            </div>
                                            <div className="progress-bar-container">
                                                <div
                                                    className="progress-bar"
                                                    style={{
                                                        width: `${score * 10}%`,
                                                        backgroundColor: '#8250c8'
                                                    }}
                                                ></div>
                                            </div>
                                            <div className="reasoning-container">
                                                <h5 className="reasoning-title">Reasoning:</h5>
                                                <div className="reasoning-card full">{reasoning}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeTab === 'experience' && job.prompt.includes("Experience") && (
                        <div className="tab-content scores-tab">
                            <h3 className="tab-title">Experience Evaluation</h3>
                            <div className="score-cards-grid">
                                {[{ key: 'jobExp', title: 'Job Experience' },
                                { key: 'projectCocurricularExp', title: 'Projects & Co-curricular' },
                                { key: 'certification', title: 'Certifications' }
                                ].map((item) => {
                                    const score = applicant.rank_score?.[item.key] || 0;
                                    const reasoning = applicant.reasoning?.[item.key] || "No reasoning provided";

                                    return (
                                        <div key={item.key} className="score-card compact-card">
                                            <div className="score-header">
                                                <h4>{item.title}</h4>
                                                <div className="score-value">{score}/10</div>
                                            </div>
                                            <div className="progress-bar-container">
                                                <div
                                                    className="progress-bar"
                                                    style={{
                                                        width: `${score * 10}%`,
                                                        backgroundColor: '#dd20c1'
                                                    }}
                                                ></div>
                                            </div>
                                            <div className="reasoning-container">
                                                <h5 className="reasoning-title">Reasoning:</h5>
                                                <div className="reasoning-card full">{reasoning}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeTab === 'education' && job.prompt.includes("Education") && (
                        <div className="tab-content scores-tab">
                            <h3 className="tab-title">Education Evaluation</h3>
                            <div className="score-cards-grid">
                                {[{ key: 'studyLevel', title: 'Level of Study' },
                                { key: 'awards', title: 'Awards & Achievements' },
                                { key: 'courseworkResearch', title: 'Relevant Coursework' }
                                ].map((item) => {
                                    const score = applicant.rank_score?.[item.key] || 0;
                                    const reasoning = applicant.reasoning?.[item.key] || "No reasoning provided";

                                    return (
                                        <div key={item.key} className="score-card compact-card">
                                            <div className="score-header">
                                                <h4>{item.title}</h4>
                                                <div className="score-value">{score}/10</div>
                                            </div>
                                            <div className="progress-bar-container">
                                                <div
                                                    className="progress-bar"
                                                    style={{
                                                        width: `${score * 10}%`,
                                                        backgroundColor: '#0066cc'
                                                    }}
                                                ></div>
                                            </div>
                                            <div className="reasoning-container">
                                                <h5 className="reasoning-title">Reasoning:</h5>
                                                <div className="reasoning-card full">{reasoning}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {activeTab === 'culturalFit' && job.prompt.includes("Cultural Fit") && (
                        <div className="tab-content scores-tab">
                            <h3 className="tab-title">Cultural Fit Evaluation</h3>
                            <div className="score-cards-grid">
                                {[{ key: 'collaborationStyle', title: 'Collaboration Style' },
                                { key: 'growthMindset', title: 'Growth Mindset' },
                                { key: 'communityEngagement', title: 'Community Engagement' }
                                ].map((item) => {
                                    const score = applicant.rank_score?.[item.key] || 0;
                                    const reasoning = applicant.reasoning?.[item.key] || "No reasoning provided";

                                    return (
                                        <div key={item.key} className="score-card compact-card">
                                            <div className="score-header">
                                                <h4>{item.title}</h4>
                                                <div className="score-value">{score}/10</div>
                                            </div>
                                            <div className="progress-bar-container">
                                                <div
                                                    className="progress-bar"
                                                    style={{
                                                        width: `${score * 10}%`,
                                                        backgroundColor: '#ffa000'
                                                    }}
                                                ></div>
                                            </div>
                                            <div className="reasoning-container">
                                                <h5 className="reasoning-title">Reasoning:</h5>
                                                <div className="reasoning-card full">{reasoning}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default function ApplicantDetails() {
    const [isLoading, setIsLoading] = useState(true);
    const [processingAction, setProcessingAction] = useState(false);
    const [error, setError] = useState(null);
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showInfoModal, setShowInfoModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState('');
    const [modalMessage, setModalMessage] = useState("");
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showScoringStandardModal, setShowScoringStandardModal] = useState(false);
    const [showDetailedScoringModal, setShowDetailedScoringModal] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const [applicant, setApplicant] = useState(null);
    const [job, setJob] = useState(null);
    const [detail, setDetail] = useState(null);
    const [job_id, setJob_id] = useState(null);
    const [showDetailedBreakdownModal, setShowDetailedBreakdownModal] = useState(false);
    const [showQuestionReminderModal, setShowQuestionReminderModal] = useState(false);
    const [activeDetailTab, setActiveDetailTab] = useState('skills');
    const [selectedScoreDetail, setSelectedScoreDetail] = useState(null);
    const [preloadedLogo, setPreloadedLogo] = useState(null);
    const [preloadedCroppedLogo, setPreloadedCroppedLogo] = useState(null);
    const idRef = useRef(null);

    const [showInferredSkillModal, setShowInferredSkillModal] = useState(false);
    const [currentInferredSkillData, setCurrentInferredSkillData] = useState({
        skillName: '',
        categoryTitle: '',
        explanationDetail: null
    });


    const handleScoreCardClick = (title, score, explanation, color) => {
        setSelectedScoreDetail({ title, score, explanation, color });
    };

    const closeScoreDetailModal = () => {
        setSelectedScoreDetail(null);
    };

    const handleOpenInferredSkillModal = (skillName, categoryKey, uiCategoryTitle) => {
        let detailForModal = {
            explanation: "Justification details are being processed or are unavailable for this skill.",
            evidence_sentence: "",
            highlighted_keywords: []
        };

        if (detail?.detailed_profile?.inferred_skills_explanations &&
            detail.detailed_profile.inferred_skills_explanations[categoryKey] &&
            detail.detailed_profile.inferred_skills_explanations[categoryKey][skillName]) {

            detailForModal = detail.detailed_profile.inferred_skills_explanations[categoryKey][skillName];
        } else {
            console.warn(`Explanation detail object not found for skill "${skillName}" in category "${categoryKey}". Using default.`);
        }

        setCurrentInferredSkillData({
            skillName: skillName,
            categoryTitle: uiCategoryTitle,
            explanationDetail: detailForModal
        });
        setShowInferredSkillModal(true);
    };

    const handleCloseInferredSkillModal = () => {
        setShowInferredSkillModal(false);
        setCurrentInferredSkillData({ skillName: '', categoryTitle: '', explanationDetail: null });
    };



    useEffect(() => {
        setIsLoading(true);
        setError(null);
        setShowErrorModal(false);
        setModalMessage("");
        setApplicant(null);
        setJob(null);
        setDetail(null);
        setJob_id(null);

        const fetchData = async () => {
            const pathSegments = location.pathname.split("/");
            const candidateIdFromUrl = pathSegments[pathSegments.length - 1];
            idRef.current = candidateIdFromUrl;
            const jobIdFromUrl = pathSegments[pathSegments.length - 2];
            setJob_id(jobIdFromUrl);

            if (!candidateIdFromUrl) {
                setModalMessage("Candidate ID not found in URL.");
                setShowErrorModal(true);
                setIsLoading(false);
                return;
            }

            if (!jobIdFromUrl) {
                setModalMessage("Job ID not found in URL.");
                setShowErrorModal(true);
                setIsLoading(false);
                return;
            }

            try {
                const applicants = await fetchApplicants(jobIdFromUrl);
                const jobData = await fetchJob(jobIdFromUrl);

                if (!applicants || applicants.length === 0) {
                    setModalMessage("No applicants found for this job. Please check the Job ID or try again.");
                    setShowErrorModal(true);
                    setIsLoading(false);
                    return;
                }

                const candidateData = applicants.find(candidate =>
                    candidate.candidateId && candidate.candidateId.toString() === candidateIdFromUrl
                );

                if (!candidateData) {
                    setModalMessage(`Candidate with ID ${candidateIdFromUrl} not found for this job. Please verify and try again.`);
                    setShowErrorModal(true);
                    setIsLoading(false);
                    return;
                }

                setApplicant(candidateData);
                setJob(jobData);

                let detailDataToSet;
                if (!candidateData.detailed_profile ||
                    (typeof candidateData.detailed_profile === 'object' && candidateData.detailed_profile !== null && !candidateData.detailed_profile.summary) ||
                    (typeof candidateData.detailed_profile === 'string' && candidateData.detailed_profile.trim() === "")) {
                    detailDataToSet = await handleCreateDetail(jobIdFromUrl, candidateIdFromUrl);
                } else {
                    detailDataToSet = { detailed_profile: candidateData.detailed_profile };
                }

                setDetail(detailDataToSet);
                setIsLoading(false);

            } catch (err) {
                console.error("Comprehensive error fetching candidate:", err);
                setModalMessage(`Error loading profile: ${err.message}. Please try refreshing.`);
                setShowErrorModal(true);
                setIsLoading(false);
            }
        };

        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, location.pathname]);

    useEffect(() => {
        const loadImages = async () => {
            try {
                const logoImg = new Image();
                logoImg.src = '/equalLensLogoDark.png';
                await new Promise((resolve, reject) => {
                    logoImg.onload = resolve;
                    logoImg.onerror = reject;
                    setTimeout(reject, 3000);
                });
                setPreloadedLogo(logoImg);
            } catch (err) {
                console.warn("Failed to preload main logo:", err);
            }

            try {
                const croppedLogoImg = new Image();
                croppedLogoImg.src = '/equalLensLogoDarkCropped.png';
                await new Promise((resolve, reject) => {
                    croppedLogoImg.onload = resolve;
                    croppedLogoImg.onerror = reject;
                    setTimeout(reject, 3000);
                });
                setPreloadedCroppedLogo(croppedLogoImg);
            } catch (err) {
                console.warn("Failed to preload cropped logo:", err);
            }
        };
        loadImages();
    }, []);

    const handleCreateDetail = async (currentJobId, candidateIdForDetail) => {
        if (!candidateIdForDetail) {
            setModalMessage("Candidate ID missing for detail creation.");
            setShowErrorModal(true);
            return null;
        }

        let apiUrl = `http://localhost:8000/api/candidates/detail/${candidateIdForDetail}`;
        if (currentJobId) {
            apiUrl += `?job_id=${currentJobId}&force=true`;
        } else {
            apiUrl += `?force=true`;
        }

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                const errorText = await response.text();
                console.error("Failed to generate candidate detail:", response.status, errorText);
                throw new Error(`Failed to generate candidate detail: ${response.status} - ${errorText}`);
            }
            const newDetailData = await response.json();

            setApplicant(prev => prev ? { ...prev, detailed_profile: newDetailData.detailed_profile } : null);
            return newDetailData;
        } catch (error) {
            console.error("Error in handleCreateDetail:", error);
            setModalMessage(`Error creating detail: ${error.message}`);
            setShowErrorModal(true);
            return null;
        }
    }


    const handleRegenerateProfile = async () => {
        const candidateId = idRef.current;
        if (!candidateId || !job_id) {
            setModalMessage("Missing candidate ID or job ID for regeneration.");
            setShowErrorModal(true);
            return;
        }

        try {
            setIsRegenerating(true);
            const apiUrl = `http://localhost:8000/api/candidates/detail/${candidateId}?job_id=${job_id}&force=true`;
            const response = await fetch(apiUrl);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to regenerate profile: ${response.status} - ${errorText}`);
            }

            const newDetailData = await response.json();
            setDetail(newDetailData);
            setApplicant(prev => prev ? { ...prev, detailed_profile: newDetailData.detailed_profile } : null);

            const hasRelevanceData = !!newDetailData.detailed_profile?.relevance_analysis;
            if (hasRelevanceData) {
                setModalMessage("Profile regenerated successfully with job relevance analysis!");
            } else {
                setModalMessage("Profile regenerated. Job relevance analysis might be pending or missing if no job context was available.");
            }
            setShowSuccessModal(true);

        } catch (error) {
            console.error("Error regenerating profile:", error);
            setModalMessage(`Error regenerating profile: ${error.message}`);
            setShowErrorModal(true);
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleBackToJob = () => {
        setTimeout(() => {
            if (job_id) {
                navigate(`/dashboard`, {
                    state: {
                        directToJobDetails: true,
                        jobId: job_id
                    }
                });
            } else {
                navigate("/dashboard");
            }
        }, 800);
    };

    const handleShowDetailedBreakdown = () => {
        setShowDetailedBreakdownModal(true);
    };

    const checkApplicationStatus = (action) => {
        if (!applicant || !applicant.status) {
            return true;
        }

        const status = applicant.status.toLowerCase();

        if (action === 'accept') {
            if (status === 'interview scheduled' || status === 'interview completed') {
                setModalMessage("This candidate already has an interview scheduled or completed.");
                setShowInfoModal(true);
                return false;
            } else if (status === 'rejected') {
                setModalMessage("This candidate has already been rejected.");
                setShowInfoModal(true);
                return false;
            }
        } else if (action === 'reject') {
            if (status === 'rejected') {
                setModalMessage("This candidate has already been rejected.");
                setShowInfoModal(true);
                return false;
            } else if (status === 'interview completed') {
                setModalMessage("This candidate has already completed their interview. You might want to update their status differently.");
                setShowInfoModal(true);
                return false;
            }
        }
        return true;
    };

    const handleAcceptCandidate = () => {
        if (!checkApplicationStatus('accept')) {
            return;
        }
        setConfirmAction('accept');
        setModalMessage("Are you sure you want to invite this candidate for an interview? The interview link will expire in 3 days.");
        setShowConfirmModal(true);
    };

    const handleRejectCandidate = () => {
        if (!checkApplicationStatus('reject')) {
            return;
        }
        setConfirmAction('reject');
        setModalMessage("Are you sure you want to reject this candidate?");
        setShowConfirmModal(true);
    };

    const handleConfirmAction = async () => {
        setShowConfirmModal(false);
        setProcessingAction(true);

        try {
            const applicantEmail = applicant?.extractedText?.entities?.applicant_mail ||
                applicant?.extractedText?.applicant_mail ||
                detail?.detailed_profile?.extractedText?.entities?.applicant_mail ||
                null;

            if (confirmAction === 'accept') {
                const payload = {
                    applicationId: applicant.applicationId,
                    candidateId: applicant.candidateId,
                    jobId: job_id,
                    email: applicantEmail
                };

                const response = await fetch('http://localhost:8000/api/interviews/generate-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    try {
                        const errorJson = JSON.parse(errorText);
                        throw new Error(`Failed to generate interview link: ${errorJson.detail ? JSON.stringify(errorJson.detail) : errorText}`);
                    } catch (e) {
                        throw new Error(`Failed to generate interview link: ${errorText}`);
                    }
                }

                setModalMessage(`Interview invitation has been sent to the candidate. The link will expire in 7 days.`);
                setShowSuccessModal(true);
                setApplicant(prevApplicant => ({ ...prevApplicant, status: 'interview scheduled' }));
                setTimeout(() => { setShowSuccessModal(false); setShowQuestionReminderModal(true); }, 1500);

            } else if (confirmAction === 'reject') {
                const response = await fetch(`http://localhost:8000/api/interviews/reject`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        applicationId: applicant.applicationId,
                        candidateId: applicant.candidateId,
                        jobId: job_id,
                        email: applicantEmail
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to reject candidate: ${errorText}`);
                }

                setModalMessage('Rejection email has been sent to the candidate.');
                setShowSuccessModal(true);
                setApplicant(prevApplicant => ({ ...prevApplicant, status: 'rejected' }));
            }
        } catch (error) {
            console.error("Error processing candidate action:", error);
            setModalMessage(`Error: ${error.message}`);
            setShowErrorModal(true);
        } finally {
            setProcessingAction(false);
        }
    };

    const exportGraphDataToCSV = () => {
        if (!applicant || !applicant.rank_score || !job) {
            setModalMessage("No candidate data available for export.");
            setShowErrorModal(true);
            return;
        }
        const weights = {
            "skills": { "relevance": 0.50, "proficiency": 0.35, "additionalSkill": 0.15 },
            "experience": { "jobExp": 0.50, "projectCocurricularExp": 0.30, "certification": 0.20 },
            "education": { "studyLevel": 0.40, "awards": 0.30, "courseworkResearch": 0.30 },
            "culturalFit": { "collaborationStyle": 0.40, "growthMindset": 0.30, "communityEngagement": 0.30 }
        };
        const selectedCriteria = [];
        if (job.prompt.includes("Skills")) selectedCriteria.push("skills");
        if (job.prompt.includes("Experience")) selectedCriteria.push("experience");
        if (job.prompt.includes("Education")) selectedCriteria.push("education");
        if (job.prompt.includes("Cultural Fit")) selectedCriteria.push("culturalFit");
        const criteriaDisplayNames = {
            "skills": { "relevance": "Relevance to Job", "proficiency": "Proficiency Level", "additionalSkill": "Additional Skills" },
            "experience": { "jobExp": "Job Experience", "projectCocurricularExp": "Projects & Co-curricular", "certification": "Certifications" },
            "education": { "studyLevel": "Level of Study", "awards": "Awards & Achievements", "courseworkResearch": "Relevant Coursework" },
            "culturalFit": { "collaborationStyle": "Collaboration Style", "growthMindset": "Growth Mindset", "communityEngagement": "Community Engagement" }
        };
        const scores = {
            "skills": { "relevance": applicant.rank_score.relevance || 0, "proficiency": applicant.rank_score.proficiency || 0, "additionalSkill": applicant.rank_score.additionalSkill || 0 },
            "experience": { "jobExp": applicant.rank_score.jobExp || 0, "projectCocurricularExp": applicant.rank_score.projectCocurricularExp || 0, "certification": applicant.rank_score.certification || 0 },
            "education": { "studyLevel": applicant.rank_score.studyLevel || 0, "awards": applicant.rank_score.awards || 0, "courseworkResearch": applicant.rank_score.courseworkResearch || 0 },
            "culturalFit": { "collaborationStyle": applicant.rank_score.collaborationStyle || 0, "growthMindset": applicant.rank_score.growthMindset || 0, "communityEngagement": applicant.rank_score.communityEngagement || 0 }
        };
        const weightedScores = {};
        Object.keys(scores).forEach(mainCriteria => {
            weightedScores[mainCriteria] = {};
            Object.keys(scores[mainCriteria]).forEach(subCriteria => {
                weightedScores[mainCriteria][subCriteria] = scores[mainCriteria][subCriteria] * weights[mainCriteria][subCriteria];
            });
        });
        let csvContent = "data:text/csv;charset=utf-8,";
        selectedCriteria.forEach(criteria => {
            const subCriteria = Object.keys(scores[criteria]);
            const displayNames = criteriaDisplayNames[criteria];
            csvContent += `\n${criteria.toUpperCase()} CRITERIA ANALYSIS\n\n`;
            for (let i = 0; i < subCriteria.length; i++) {
                for (let j = i + 1; j < subCriteria.length; j++) {
                    const crit1 = subCriteria[i];
                    const crit2 = subCriteria[j];
                    csvContent += `${displayNames[crit1]} vs ${displayNames[crit2]}\n`;
                    csvContent += "Criteria,Raw Score,Weighted Score,Weight\n";
                    csvContent += `${displayNames[crit1]},${scores[criteria][crit1]},${weightedScores[criteria][crit1]},${weights[criteria][crit1]}\n`;
                    csvContent += `${displayNames[crit2]},${scores[criteria][crit2]},${weightedScores[criteria][crit2]},${weights[criteria][crit2]}\n\n`;
                }
            }
            csvContent += `All ${criteria} Subcriteria Comparison\n`;
            csvContent += "Criteria,Raw Score,Weighted Score,Weight\n";
            subCriteria.forEach(sub => {
                csvContent += `${displayNames[sub]},${scores[criteria][sub]},${weightedScores[criteria][sub]},${weights[criteria][sub]}\n`;
            });
            csvContent += "\n";
        });
        csvContent += "OVERALL SUMMARY\n";
        csvContent += "Criteria,Category,Raw Score,Weighted Score,Weight\n";
        selectedCriteria.forEach(criteria => {
            const subCriteria = Object.keys(scores[criteria]);
            const displayNames = criteriaDisplayNames[criteria];
            subCriteria.forEach(sub => {
                csvContent += `${criteria},${displayNames[sub]},${scores[criteria][sub]},${weightedScores[criteria][sub]},${weights[criteria][sub]}\n`;
            });
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `${applicant?.candidateId || "candidate"}_graph_data.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportToPDF = async () => {
        setShowExportModal(false);
        setModalMessage("Generating PDF report...");
        setShowInfoModal(true);
        Chart.register(ChartDataLabels);
        try {
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
            pdf.setFont("helvetica");
            const signatureColors = {
                primary: '#F9645F', skills: '#8250c8', experience: '#dd20c1', education: '#0066cc', culturalFit: '#ffa000',
                gradient: { start: '#F9645F', mid: '#ff8783', end: '#ffa799' }
            };
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            pdf.setFillColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
            pdf.rect(0, 0, pageWidth, 12, 'F');
            pdf.rect(0, pageHeight - 12, pageWidth, 12, 'F');
            const contentStartY = pageHeight * 0.3;
            pdf.setFontSize(32);
            pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
            pdf.text(`Resume Assessment Report`, pageWidth / 2, contentStartY, { align: 'center' });
            pdf.setFontSize(20);
            pdf.setTextColor(60, 60, 60);
            pdf.text(`Candidate: ${applicant?.candidateId || "Unspecified"}`, pageWidth / 2, contentStartY + 70, { align: 'center' });
            pdf.text(`Position: ${job?.jobTitle || "Unknown Position"}`, pageWidth / 2, contentStartY + 110, { align: 'center' });
            pdf.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth / 2, contentStartY + 150, { align: 'center' });
            if (applicant?.rank_score?.final_score) {
                pdf.setFillColor(245, 245, 245);
                pdf.roundedRect(pageWidth / 2 - 85, contentStartY + 190, 170, 80, 8, 8, 'F');
                pdf.setFontSize(18);
                pdf.setTextColor(80, 80, 80);
                pdf.text("Overall Score", pageWidth / 2, contentStartY + 220, { align: 'center' });
                pdf.setFontSize(28);
                pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.text(`${applicant.rank_score.final_score.toFixed(1)}/100`, pageWidth / 2, contentStartY + 255, { align: 'center' });
            }
            if (preloadedLogo) {
                try {
                    const logoWidth = 120; const logoHeight = (preloadedLogo.height * logoWidth) / preloadedLogo.width;
                    pdf.addImage(preloadedLogo, 'PNG', (pageWidth - logoWidth) / 2, pageHeight - 100, logoWidth, logoHeight);
                } catch (imgErr) {
                    console.warn("Error adding preloaded logo:", imgErr);
                    pdf.setFontSize(16); pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                    pdf.text('EqualLens', pageWidth / 2, pageHeight - 50, { align: 'center' });
                }
            } else {
                pdf.setFontSize(16); pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.text('EqualLens', pageWidth / 2, pageHeight - 50, { align: 'center' });
            }
            const addHeaderAndFooter = (pageNum) => {
                if (pageNum <= 1) return;
                pdf.setFillColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.rect(0, 0, pageWidth, 6, 'F');
                if (preloadedCroppedLogo) {
                    try {
                        const logoWidth = 60; const logoHeight = (preloadedCroppedLogo.height * logoWidth) / preloadedCroppedLogo.width;
                        pdf.addImage(preloadedCroppedLogo, 'PNG', 40, 15, logoWidth, logoHeight);
                    } catch (imgErr) {
                        console.warn("Error adding preloaded cropped logo:", imgErr);
                        pdf.setFontSize(14); pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                        pdf.text("EqualLens Assessment", 60, 40);
                    }
                } else {
                    pdf.setFontSize(14); pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                    pdf.text("EqualLens Assessment", 60, 40);
                }
                pdf.setFillColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.rect(0, pageHeight - 6, pageWidth, 6, 'F');
                pdf.setFontSize(12); pdf.setTextColor(80, 80, 80);
                pdf.text(`Page ${pageNum}`, pageWidth - 40, pageHeight - 20, { align: 'right' });
            };
            pdf.addPage(); addHeaderAndFooter(2);
            pdf.setFillColor(248, 249, 250); pdf.rect(0, 50, pageWidth, 50, 'F');
            pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
            pdf.setFontSize(22); pdf.text("Overall Profile Assessment", pageWidth / 2, 80, { align: 'center' });
            const radarElement = document.querySelector('.radar-chart-container');
            if (radarElement) {
                const radarCanvas = await html2canvas(radarElement, {
                    scale: 2, backgroundColor: '#ffffff', height: radarElement.offsetHeight + 60,
                    width: radarElement.offsetWidth + 60, x: -30, y: -30, useCORS: true, allowTaint: true, logging: false
                });
                const radarImgData = radarCanvas.toDataURL('image/jpeg', 0.9);
                const imgProps = pdf.getImageProperties(radarImgData);
                const pdfWidth = pageWidth * 0.85; const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
                const x = (pageWidth - pdfWidth) / 2; const y = 120;
                pdf.addImage(radarImgData, 'JPEG', x, y, pdfWidth, pdfHeight);
                pdf.setFontSize(14); pdf.setTextColor(80, 80, 80);
                pdf.text("This radar chart visualizes the candidate's scores across all assessed criteria. Higher values indicate stronger qualifications in that area.",
                    pageWidth / 2, y + pdfHeight + 40, { align: 'center', maxWidth: pageWidth * 0.8 });
            }
            const selectedCriteriaPDF = [];
            if (job?.prompt?.includes("Skills")) selectedCriteriaPDF.push("skills");
            if (job?.prompt?.includes("Experience")) selectedCriteriaPDF.push("experience");
            if (job?.prompt?.includes("Education")) selectedCriteriaPDF.push("education");
            if (job?.prompt?.includes("Cultural Fit")) selectedCriteriaPDF.push("culturalFit");
            const weightsPDF = {
                "skills": { "relevance": 0.50, "proficiency": 0.35, "additionalSkill": 0.15 },
                "experience": { "jobExp": 0.50, "projectCocurricularExp": 0.30, "certification": 0.20 },
                "education": { "studyLevel": 0.40, "awards": 0.30, "courseworkResearch": 0.30 },
                "culturalFit": { "collaborationStyle": 0.40, "growthMindset": 0.30, "communityEngagement": 0.30 }
            };
            const criteriaDisplayNamesPDF = {
                "skills": { "relevance": "Relevance to Job", "proficiency": "Proficiency Level", "additionalSkill": "Additional Skills" },
                "experience": { "jobExp": "Job Experience", "projectCocurricularExp": "Projects & Co-curricular", "certification": "Certifications" },
                "education": { "studyLevel": "Level of Study", "awards": "Awards & Achievements", "courseworkResearch": "Relevant Coursework" },
                "culturalFit": { "collaborationStyle": "Collaboration Style", "growthMindset": "Growth Mindset", "communityEngagement": "Community Engagement" }
            };
            const scoresPDF = {
                "skills": { "relevance": applicant?.rank_score?.relevance || 0, "proficiency": applicant?.rank_score?.proficiency || 0, "additionalSkill": applicant?.rank_score?.additionalSkill || 0 },
                "experience": { "jobExp": applicant?.rank_score?.jobExp || 0, "projectCocurricularExp": applicant?.rank_score?.projectCocurricularExp || 0, "certification": applicant?.rank_score?.certification || 0 },
                "education": { "studyLevel": applicant?.rank_score?.studyLevel || 0, "awards": applicant?.rank_score?.awards || 0, "courseworkResearch": applicant?.rank_score?.courseworkResearch || 0 },
                "culturalFit": { "collaborationStyle": applicant?.rank_score?.collaborationStyle || 0, "growthMindset": applicant?.rank_score?.growthMindset || 0, "communityEngagement": applicant?.rank_score?.communityEngagement || 0 }
            };
            const addUnifiedReasoningContainer = (criteria, x, y, width) => {
                const subCriteria = Object.keys(scoresPDF[criteria]);
                const displayNames = criteriaDisplayNamesPDF[criteria];
                const themeColor = signatureColors[criteria];
                const fontSize = 11; const lineHeight = 14; const headerSize = 13; const contentStartY = y + 40;
                pdf.setFontSize(headerSize); pdf.setTextColor(hexToRgb(themeColor).r, hexToRgb(themeColor).g, hexToRgb(themeColor).b);
                pdf.text("Assessment Reasoning", x + width / 2, y + 20, { align: 'center' });
                let totalHeight = 70;
                const reasoningTexts = [];
                subCriteria.forEach(sub => {
                    const text = applicant?.reasoning?.[sub] || `No reasoning provided for ${displayNames[sub]}`;
                    const splitText = pdf.splitTextToSize(text, width - 50);
                    reasoningTexts.push({ title: displayNames[sub], text: splitText, lines: splitText.length });
                    totalHeight += 30 + (splitText.length * lineHeight);
                });
                pdf.setFillColor(240, 240, 240); pdf.roundedRect(x + 3, y + 3, width, totalHeight, 8, 8, 'F');
                pdf.setFillColor(250, 250, 250); pdf.roundedRect(x, y, width, totalHeight, 8, 8, 'F');
                pdf.setDrawColor(hexToRgb(themeColor).r, hexToRgb(themeColor).g, hexToRgb(themeColor).b, 0.5);
                pdf.setLineWidth(0.75); pdf.roundedRect(x, y, width, totalHeight, 8, 8, 'S');
                let currentY = contentStartY;
                reasoningTexts.forEach((item, index) => {
                    pdf.setFontSize(fontSize + 1); pdf.setTextColor(hexToRgb(themeColor).r, hexToRgb(themeColor).g, hexToRgb(themeColor).b);
                    pdf.text(`${item.title}: ${scoresPDF[criteria][subCriteria[index]].toFixed(1)}/10`, x + 25, currentY); currentY += 20;
                    pdf.setFontSize(fontSize); pdf.setTextColor(60, 60, 60);
                    pdf.text(item.text, x + 25, currentY); currentY += item.lines * lineHeight + 20;
                });
                return totalHeight;
            };
            for (let criteriaIndex = 0; criteriaIndex < selectedCriteriaPDF.length; criteriaIndex++) {
                const criteria = selectedCriteriaPDF[criteriaIndex];
                pdf.addPage(); addHeaderAndFooter(criteriaIndex + 3);
                pdf.setFillColor(248, 249, 250); pdf.rect(0, 50, pageWidth, 50, 'F');
                pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                pdf.setFontSize(22); pdf.text(`${criteria.charAt(0).toUpperCase() + criteria.slice(1)} Assessment`, pageWidth / 2, 80, { align: 'center' });
                const subCriteria = Object.keys(scoresPDF[criteria]);
                const displayNames = criteriaDisplayNamesPDF[criteria];
                const chartColor = signatureColors[criteria];
                const pairs = [];
                for (let i = 0; i < subCriteria.length; i++) {
                    for (let j = i + 1; j < subCriteria.length; j++) { pairs.push([subCriteria[i], subCriteria[j]]); }
                }
                const chartWidth = pageWidth * 0.85; const chartHeight = 180; const chartGap = 35;
                const canvases = [];
                for (let i = 0; i < pairs.length; i++) {
                    const canvas = document.createElement('canvas'); canvas.id = `chart-${criteria}-${i}`;
                    canvas.width = 800; canvas.height = 400; canvas.style.display = 'none'; document.body.appendChild(canvas); canvases.push(canvas);
                    const [crit1, crit2] = pairs[i]; const ctx = canvas.getContext('2d');
                    new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: [displayNames[crit1], displayNames[crit2]],
                            datasets: [
                                { label: 'Raw Score', data: [scoresPDF[criteria][crit1], scoresPDF[criteria][crit2]], backgroundColor: hexToRgba(chartColor, 0.6), borderColor: chartColor, borderWidth: 1, borderRadius: 8, barPercentage: 0.5, categoryPercentage: 0.7 },
                                { label: 'Weighted Score', data: [scoresPDF[criteria][crit1] * weightsPDF[criteria][crit1], scoresPDF[criteria][crit2] * weightsPDF[criteria][crit2]], backgroundColor: hexToRgba(chartColor, 0.3), borderColor: chartColor, borderWidth: 1, borderRadius: 8, barPercentage: 0.5, categoryPercentage: 0.7 }
                            ]
                        },
                        options: {
                            indexAxis: 'y',
                            plugins: {
                                title: { display: true, text: `${displayNames[crit1]} vs ${displayNames[crit2]}`, font: { size: 32, family: "'Helvetica', 'Arial', sans-serif" }, color: '#333333', padding: { top: 10, bottom: 20 } },
                                legend: { position: 'top', labels: { font: { size: 24, family: "'Helvetica', 'Arial', sans-serif" }, boxWidth: 18, padding: 20 } },
                                tooltip: { callbacks: { footer: (tooltipItems) => { const item = tooltipItems[0]; const subcritName = item.label === displayNames[crit1] ? crit1 : crit2; return `Weight: ${weightsPDF[criteria][subcritName]}`; } }, titleFont: { size: 24 }, bodyFont: { size: 20, family: "'Helvetica', 'Arial', sans-serif" } },
                                datalabels: { color: '#333', anchor: 'end', align: 'end', offset: 4, font: { size: 20, weight: 'bold', family: "'Helvetica', 'Arial', sans-serif" }, formatter: (value) => value.toFixed(1), display: function (context) { return context.dataset.data[context.dataIndex] > 0; } }
                            },
                            scales: {
                                x: { beginAtZero: true, max: 10, title: { display: true, text: 'Score', font: { size: 24, family: "'Helvetica', 'Arial', sans-serif" } }, ticks: { font: { size: 24, family: "'Helvetica', 'Arial', sans-serif" } } },
                                y: { ticks: { font: { size: 24, family: "'Helvetica', 'Arial', sans-serif" }, color: '#333333' } }
                            },
                            maintainAspectRatio: true, responsive: true, devicePixelRatio: 2
                        }
                    });
                }
                await new Promise(resolve => setTimeout(resolve, 800));
                const yPositions = [120, 120 + chartHeight + chartGap, 120 + (chartHeight + chartGap) * 2];
                for (let i = 0; i < canvases.length; i++) {
                    const chartImg = canvases[i].toDataURL('image/png', 1.0);
                    const x = (pageWidth - chartWidth) / 2; const y = yPositions[i];
                    pdf.addImage(chartImg, 'PNG', x, y, chartWidth, chartHeight);
                }
                const lastChartBottom = yPositions[canvases.length - 1] + chartHeight + 50;
                if (lastChartBottom > pageHeight - 150) {
                    pdf.addPage(); addHeaderAndFooter(criteriaIndex + selectedCriteriaPDF.length + 3);
                    pdf.setFillColor(248, 249, 250); pdf.rect(0, 50, pageWidth, 50, 'F');
                    pdf.setTextColor(hexToRgb(signatureColors.primary).r, hexToRgb(signatureColors.primary).g, hexToRgb(signatureColors.primary).b);
                    pdf.setFontSize(22); pdf.text(`${criteria.charAt(0).toUpperCase() + criteria.slice(1)} Reasoning`, pageWidth / 2, 80, { align: 'center' });
                    addUnifiedReasoningContainer(criteria, (pageWidth - chartWidth) / 2, 120, chartWidth);
                } else {
                    addUnifiedReasoningContainer(criteria, (pageWidth - chartWidth) / 2, lastChartBottom, chartWidth);
                }
                canvases.forEach(canvas => document.body.removeChild(canvas));
            }
            pdf.save(`${applicant?.candidateId || "candidate"}_assessment.pdf`);
            setShowInfoModal(false);
            setModalMessage("PDF report generated successfully!");
            setShowSuccessModal(true);
        } catch (error) {
            console.error("Error generating PDF:", error);
            setShowInfoModal(false);
            setModalMessage("Failed to generate PDF: " + error.message);
            setShowErrorModal(true);
        }
    };

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
    }

    function hexToRgba(hex, alpha) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

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
                <h3 className="status-title">Profile Loading Failed!</h3>
                <p className="status-description">{modalMessage || "Failed to update job details."}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => setShowErrorModal(false)}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );

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
                <h3 className="status-title">{modalMessage.includes("PDF") ? "Please Hold" : "Information"}</h3>
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

    const SuccessModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal success-modal">
                <div className="status-icon success-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                </div>
                <h3 className="status-title">Success</h3>
                <p className="status-description">{modalMessage}</p>
                <div className="status-buttons">
                    <button className="status-button primary-button" onClick={() => {
                        setShowSuccessModal(false);
                        if (confirmAction !== 'accept' &&
                            confirmAction !== '' &&
                            !modalMessage.includes("PDF") &&
                            !modalMessage.includes("report") &&
                            !modalMessage.includes("profile")) {
                            handleBackToJob();
                        }
                    }}>
                        Close
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
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <h3 className="status-title">Confirm Action</h3>
                <p className="status-description">{modalMessage}</p>

                <div className="status-buttons">
                    <button className="status-button secondary-button" onClick={() => setShowConfirmModal(false)}>
                        Cancel
                    </button>
                    <button className="status-button primary-button" onClick={handleConfirmAction}>
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );

    const QuestionReminderModal = () => (
        <div className="status-modal-overlay" role="dialog" aria-modal="true">
            <div className="status-modal">
                <div className="status-icon warning-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ff9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        <path d="M15 6l3 3"></path>
                        <circle cx="18" cy="6" r="1"></circle>
                    </svg>
                </div>
                <h3 className="status-title">Create Interview Questions</h3>
                <p className="status-description">
                    Remember to create interview questions for this candidate to ensure a structured interview process. Would you like to create questions now?
                </p>
                <div className="status-buttons">
                    <button
                        className="status-button secondary-button"
                        onClick={() => {
                            setShowQuestionReminderModal(false);
                            handleBackToJob();
                        }}
                    >
                        Not Now
                    </button>
                    <button
                        className="status-button primary-button"
                        onClick={() => {
                            setShowQuestionReminderModal(false);
                            if (job_id && applicant && applicant.candidateId) {
                                navigate(`/add-interview-questions?jobId=${job_id}&candidateId=${applicant.candidateId}`);
                            } else {
                                console.error("Missing job ID or candidate ID for navigation.");
                                navigate(`/add-interview-questions?jobId=${job_id || ''}`);
                            }
                        }}
                    >
                        Create Questions
                    </button>
                </div>
            </div>
        </div>
    );

    const ExportModal = () => {
        if (!showExportModal) return null;

        return (
            <div
                className="status-modal-overlay"
                role="dialog"
                aria-modal="true"
                onClick={() => setShowExportModal(false)}
            >
                <div
                    className="status-modal"
                    style={{ maxWidth: "400px" }}
                    onClick={e => e.stopPropagation()}
                >
                    <div
                        className="status-icon"
                        aria-hidden="true"
                        style={{
                            backgroundColor: "#FEE9E9", width: "80px", height: "80px",
                            borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center"
                        }}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#F9645F" viewBox="0 0 16 16">
                            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
                            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
                        </svg>
                    </div>
                    <h3 className="status-title">Export Options</h3>
                    <p className="status-description">Choose your preferred export format:</p>
                    <div className="status-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button
                            className="status-button csv-button"
                            style={{ backgroundColor: '#38B2AC' }}
                            onClick={() => { setShowExportModal(false); exportGraphDataToCSV(); }}
                        >
                            CSV with Tables
                        </button>
                        <button className="status-button pdf-button" style={{ backgroundColor: '#485EDB' }} onClick={exportToPDF} >
                            PDF with Graphs
                        </button>
                        <button className="status-button secondary-button" onClick={() => setShowExportModal(false)} >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const getStatusBadge = () => {
        if (!applicant || !applicant.status) return null;
        const status = applicant.status.toLowerCase();
        let badgeClass = 'status-badge new';
        if (status === 'interview scheduled') badgeClass = 'status-badge interview';
        else if (status === 'interview completed') badgeClass = 'status-badge completed';
        else if (status === 'rejected') badgeClass = 'status-badge rejected';
        return (<div className="applicant-status-badge"><span className={badgeClass}>{applicant.status}</span></div>);
    };

    if (isLoading || processingAction || isRegenerating) {
        return (
            <div className="detail-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', backgroundColor: 'rgb(255, 255, 255)' }}>
                <div className="loading-indicator" style={{ textAlign: 'center' }}>
                    <LoadingAnimation />
                    <p style={{ marginTop: '20px' }}>
                        {processingAction ? "Processing your request..." : (isRegenerating ? "Regenerating profile..." : "Loading profile details...")}
                    </p>
                </div>
            </div>
        );
    }

    if (!applicant || !detail) {
        return (
            <div className="detail-container" style={{ padding: '20px', textAlign: 'center' }}>
                <h2>Profile Not Found</h2>
                <p>{error || "The applicant's profile details could not be loaded. Please try again or go back."}</p>
                <button className="back-button" style={{ marginTop: '20px' }} onClick={handleBackToJob}>
                    Go Back
                </button>
                {showErrorModal && <ErrorModal />}
            </div>
        );
    }


    return (
        <div className="detail-container">
            {showErrorModal && <ErrorModal />}
            {showExportModal && <ExportModal />}
            {showSuccessModal && <SuccessModal />}
            {showConfirmModal && <ConfirmModal />}
            {showInfoModal && <InfoModal />}
            {showDetailedBreakdownModal && (
                <DetailedBreakdownModal job={job} applicant={applicant} setShowDetailedBreakdownModal={setShowDetailedBreakdownModal} />
            )}
            {showQuestionReminderModal && <QuestionReminderModal />}
            {showScoringStandardModal && (<ScoringStandardModal onClose={() => setShowScoringStandardModal(false)} />)}
            {showDetailedScoringModal && (<DetailedScoringModal applicant={applicant} onClose={() => setShowDetailedScoringModal(false)} />)}
            {selectedScoreDetail && (
                <ScoreDetailModal isOpen={!!selectedScoreDetail} onClose={closeScoreDetailModal} title={selectedScoreDetail.title} score={selectedScoreDetail.score} explanation={selectedScoreDetail.explanation} color={selectedScoreDetail.color} />
            )}
            {showInferredSkillModal && (
                <InferredSkillModal
                    isOpen={showInferredSkillModal}
                    onClose={handleCloseInferredSkillModal}
                    skillName={currentInferredSkillData.skillName}
                    categoryTitle={currentInferredSkillData.categoryTitle}
                    explanationDetail={currentInferredSkillData.explanationDetail} // Pass the whole object
                />
            )}

            {!isLoading && applicant && detail && (
                <div className="applicant-detail-view">
                    <button className="back-button" onClick={handleBackToJob}>
                        <svg className="back-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                        Back to Job Details
                    </button>
                    <div className="applicant-detail-header">
                        <div className="applicant-header-left">
                            <h1>{applicant.candidateId ? applicant.candidateId + "\'s" : ""} Profile</h1>
                            {getStatusBadge()}
                        </div>
                        <div className="applicant-action-buttons">
                            <button className="accept-button" onClick={handleAcceptCandidate} disabled={applicant.status === 'interview scheduled' || applicant.status === 'interview completed' || applicant.status === 'rejected'} > Accept </button>
                            <button className="reject-button" onClick={handleRejectCandidate} disabled={applicant.status === 'rejected' || applicant.status === 'interview completed'} > Reject </button>
                        </div>
                    </div>

                    <div className="applicant-detail-content">
                        <div className="combined-container">
                            {detail.detailed_profile?.summary ? (
                                <div className="info-group">
                                    <p className="info-label">Overall Summary:</p>
                                    <div className="experience-container">
                                        <div className="experience-card">{renderHTMLContent(detail.detailed_profile.summary)}</div>
                                    </div>
                                </div>
                            ) : <div>Loading summary or not available...</div>}


                            {job?.prompt && job.prompt !== "" && (
                                <div className="ranking-criteria-header">
                                    <div className="ranking-criteria-inline">
                                        <p className="info-label">Ranking Criteria:</p>
                                        <span className="ranking-criteria-content">{job?.prompt ? job.prompt : "No criteria reference"}</span>
                                        <div className="criteria-buttons">
                                            <button className="export-csvv-button" onClick={() => setShowExportModal(true)} title="Export candidate assessment data"> Export Scores </button>
                                            <button className="view-breakdown-button" onClick={handleShowDetailedBreakdown}> View Detailed Assessment </button>
                                            <button className="show-detailed-scoring-button" onClick={() => setShowDetailedScoringModal(true)}> Show Detailed Scoring </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="assessment-section">
                                <div className="assessment-chart">
                                    <ApplicantRadarChart applicant={applicant} job={job} />
                                </div>
                                <div className="assessment-breakdown">
                                    <div className="assessment-breakdown-header">
                                        <p className="info-label">Score Breakdown:</p>
                                        <div className="scoring-info-panel" onClick={() => setShowScoringStandardModal(true)} >
                                            <div className="scoring-info-left">
                                                <div className="scoring-icon">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                                        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
                                                        <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z" />
                                                    </svg>
                                                </div>
                                                <div className="scoring-info-text">
                                                    <span className="scoring-info-title">Scoring Standard</span>
                                                </div>
                                            </div>
                                            <div className="scoring-info-arrow">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" /></svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="criteria-labels-row">
                                        {(job?.prompt?.includes("Skills") || !job?.prompt) && (<div className="criteria-label"><span className="skills-label">Skills</span></div>)}
                                        {(job?.prompt?.includes("Experience") || !job?.prompt) && (<div className="criteria-label"><span className="experience-label">Experience</span></div>)}
                                        {(job?.prompt?.includes("Education") || !job?.prompt) && (<div className="criteria-label"><span className="education-label">Education</span></div>)}
                                        {(job?.prompt?.includes("Cultural Fit") || !job?.prompt) && (<div className="criteria-label"><span className="cultural-fit-label">Cultural Fit</span></div>)}
                                    </div>
                                    {(!job?.prompt || job?.prompt === "") ? (
                                        <div className="breakdown-columns four-columns">
                                            <div className="breakdown-column">
                                                <div className="score-card"><h4>Relevance to Job</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Proficiency Level</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Additional Skills</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                            </div>
                                            <div className="breakdown-column">
                                                <div className="score-card"><h4>Job Experience</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Projects & Co-curricular</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Certifications</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                            </div>
                                            <div className="breakdown-column">
                                                <div className="score-card"><h4>Level of Study</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Awards & Achievements</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Relevant Coursework</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                            </div>
                                            <div className="breakdown-column">
                                                <div className="score-card"><h4>Collaboration Style</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Growth Mindset</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                                <div className="score-card"><h4>Community Engagement</h4><div className="progress-bar-container"><div className="progress-bar unranked" style={{ width: '100%', backgroundColor: '#d9d9d9' }}></div></div><p>N/A</p></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className={`breakdown-columns ${[job?.prompt?.includes("Skills"), job?.prompt?.includes("Experience"), job?.prompt?.includes("Education"), job?.prompt?.includes("Cultural Fit")].filter(Boolean).length === 1 ? "single-column" : [job?.prompt?.includes("Skills"), job?.prompt?.includes("Experience"), job?.prompt?.includes("Education"), job?.prompt?.includes("Cultural Fit")].filter(Boolean).length === 2 ? "two-columns" : [job?.prompt?.includes("Skills"), job?.prompt?.includes("Experience"), job?.prompt?.includes("Education"), job?.prompt?.includes("Cultural Fit")].filter(Boolean).length === 3 ? "three-columns" : "four-columns"}`}>
                                            {job?.prompt?.includes("Skills") && (
                                                <div className="breakdown-column">
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Relevance to Job", applicant.rank_score?.relevance || 0, applicant.reasoning?.relevance, "#8250c8")}><h4>Relevance to Job</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Skills") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Skills") ? '100%' : `${applicant.rank_score?.relevance ? (applicant.rank_score.relevance * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Skills") ? '#d9d9d9' : '#8250c8' }}></div></div><p>{!job?.prompt?.includes("Skills") ? "Unranked" : (applicant.rank_score?.relevance ? `${applicant.rank_score.relevance}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Proficiency Level", applicant.rank_score?.proficiency || 0, applicant.reasoning?.proficiency, "#8250c8")}><h4>Proficiency Level</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Skills") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Skills") ? '100%' : `${applicant.rank_score?.proficiency ? (applicant.rank_score.proficiency * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Skills") ? '#d9d9d9' : '#8250c8' }}></div></div><p>{!job?.prompt?.includes("Skills") ? "Unranked" : (applicant.rank_score?.proficiency ? `${applicant.rank_score.proficiency}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Additional Skills", applicant.rank_score?.additionalSkill || 0, applicant.reasoning?.additionalSkill, "#8250c8")}><h4>Additional Skills</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Skills") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Skills") ? '100%' : `${applicant.rank_score?.additionalSkill ? (applicant.rank_score.additionalSkill * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Skills") ? '#d9d9d9' : '#8250c8' }}></div></div><p>{!job?.prompt?.includes("Skills") ? "Unranked" : (applicant.rank_score?.additionalSkill ? `${applicant.rank_score.additionalSkill}/10` : "0/10")}</p></div>
                                                </div>
                                            )}
                                            {job?.prompt?.includes("Experience") && (
                                                <div className="breakdown-column">
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Job Experience", applicant.rank_score?.jobExp || 0, applicant.reasoning?.jobExp, "#dd20c1")}><h4>Job Experience</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Experience") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Experience") ? '100%' : `${applicant.rank_score?.jobExp ? (applicant.rank_score.jobExp * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Experience") ? '#d9d9d9' : '#dd20c1' }}></div></div><p>{!job?.prompt?.includes("Experience") ? "Unranked" : (applicant.rank_score?.jobExp ? `${applicant.rank_score.jobExp}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Projects & Co-curricular", applicant.rank_score?.projectCocurricularExp || 0, applicant.reasoning?.projectCocurricularExp, "#dd20c1")}><h4>Projects & Co-curricular</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Experience") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Experience") ? '100%' : `${applicant.rank_score?.projectCocurricularExp ? (applicant.rank_score.projectCocurricularExp * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Experience") ? '#d9d9d9' : '#dd20c1' }}></div></div><p>{!job?.prompt?.includes("Experience") ? "Unranked" : (applicant.rank_score?.projectCocurricularExp ? `${applicant.rank_score.projectCocurricularExp}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Certifications", applicant.rank_score?.certification || 0, applicant.reasoning?.certification, "#dd20c1")}><h4>Certifications</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Experience") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Experience") ? '100%' : `${applicant.rank_score?.certification ? (applicant.rank_score.certification * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Experience") ? '#d9d9d9' : '#dd20c1' }}></div></div><p>{!job?.prompt?.includes("Experience") ? "Unranked" : (applicant.rank_score?.certification ? `${applicant.rank_score.certification}/10` : "0/10")}</p></div>
                                                </div>
                                            )}
                                            {job?.prompt?.includes("Education") && (
                                                <div className="breakdown-column">
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Level of Study", applicant.rank_score?.studyLevel || 0, applicant.reasoning?.studyLevel, "#0066cc")}><h4>Level of Study</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Education") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Education") ? '100%' : `${applicant.rank_score?.studyLevel ? (applicant.rank_score.studyLevel * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Education") ? '#d9d9d9' : '#0066cc' }}></div></div><p>{!job?.prompt?.includes("Education") ? "Unranked" : (applicant.rank_score?.studyLevel ? `${applicant.rank_score.studyLevel}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Awards & Achievements", applicant.rank_score?.awards || 0, applicant.reasoning?.awards, "#0066cc")}><h4>Awards & Achievements</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Education") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Education") ? '100%' : `${applicant.rank_score?.awards ? (applicant.rank_score.awards * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Education") ? '#d9d9d9' : '#0066cc' }}></div></div><p>{!job?.prompt?.includes("Education") ? "Unranked" : (applicant.rank_score?.awards ? `${applicant.rank_score.awards}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Relevant Coursework", applicant.rank_score?.courseworkResearch || 0, applicant.reasoning?.courseworkResearch, "#0066cc")}><h4>Relevant Coursework</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Education") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Education") ? '100%' : `${applicant.rank_score?.courseworkResearch ? (applicant.rank_score.courseworkResearch * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Education") ? '#d9d9d9' : '#0066cc' }}></div></div><p>{!job?.prompt?.includes("Education") ? "Unranked" : (applicant.rank_score?.courseworkResearch ? `${applicant.rank_score.courseworkResearch}/10` : "0/10")}</p></div>
                                                </div>
                                            )}
                                            {job?.prompt?.includes("Cultural Fit") && (
                                                <div className="breakdown-column">
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Collaboration Style", applicant.rank_score?.collaborationStyle || 0, applicant.reasoning?.collaborationStyle, "#ffa000")}><h4>Collaboration Style</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Cultural Fit") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Cultural Fit") ? '100%' : `${applicant.rank_score?.collaborationStyle ? (applicant.rank_score.collaborationStyle * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Cultural Fit") ? '#d9d9d9' : '#ffa000' }}></div></div><p>{!job?.prompt?.includes("Cultural Fit") ? "Unranked" : (applicant.rank_score?.collaborationStyle ? `${applicant.rank_score.collaborationStyle}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Growth Mindset", applicant.rank_score?.growthMindset || 0, applicant.reasoning?.growthMindset, "#ffa000")}><h4>Growth Mindset</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Cultural Fit") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Cultural Fit") ? '100%' : `${applicant.rank_score?.growthMindset ? (applicant.rank_score.growthMindset * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Cultural Fit") ? '#d9d9d9' : '#ffa000' }}></div></div><p>{!job?.prompt?.includes("Cultural Fit") ? "Unranked" : (applicant.rank_score?.growthMindset ? `${applicant.rank_score.growthMindset}/10` : "0/10")}</p></div>
                                                    <div className="score-card" onClick={() => handleScoreCardClick("Community Engagement", applicant.rank_score?.communityEngagement || 0, applicant.reasoning?.communityEngagement, "#ffa000")}><h4>Community Engagement</h4><div className="progress-bar-container"><div className={`progress-bar ${!job?.prompt?.includes("Cultural Fit") ? 'unranked' : ''}`} style={{ width: !job?.prompt?.includes("Cultural Fit") ? '100%' : `${applicant.rank_score?.communityEngagement ? (applicant.rank_score.communityEngagement * 10) : 0}%`, backgroundColor: !job?.prompt?.includes("Cultural Fit") ? '#d9d9d9' : '#ffa000' }}></div></div><p>{!job?.prompt?.includes("Cultural Fit") ? "Unranked" : (applicant.rank_score?.communityEngagement ? `${applicant.rank_score.communityEngagement}/10` : "0/10")}</p></div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="candidate-tabs-container">
                            <div className="candidate-tabs">
                                <button className={`candidate-tab ${activeDetailTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveDetailTab('skills')}>Skills</button>
                                <button className={`candidate-tab ${activeDetailTab === 'education' ? 'active' : ''}`} onClick={() => setActiveDetailTab('education')}>Education</button>
                                <button className={`candidate-tab ${activeDetailTab === 'experience' ? 'active' : ''}`} onClick={() => setActiveDetailTab('experience')}>Experience</button>
                            </div>
                            <div className="candidate-tab-content">
                                {activeDetailTab === 'skills' && (<SkillsTabContent detail={detail} handleRegenerateProfile={handleRegenerateProfile} onOpenInferredSkillModal={handleOpenInferredSkillModal} />)}
                                {activeDetailTab === 'education' && (<EducationTabContent detail={detail} />)}
                                {activeDetailTab === 'experience' && (<ExperienceTabContent detail={detail} />)}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
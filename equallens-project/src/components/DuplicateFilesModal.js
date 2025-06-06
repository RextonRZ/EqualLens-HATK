import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Keep if you plan to use fetchMatchData later
import './DuplicateFilesModal.css';

const DuplicateFilesModal = ({ isOpen, duplicates, onClose, onProceed, onUploadNonDuplicates, nonDuplicateCount }) => {
  const [selectedDuplicates, setSelectedDuplicates] = useState({});
  const [matchData, setMatchData] = useState({}); // Keep for future or if fetchMatchData is re-enabled
  const [expandedChanges, setExpandedChanges] = useState({});
  const [groupedDuplicates, setGroupedDuplicates] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({});

  const sanitizeHTML = (html) => {
    if (!html) return '';
    return html.replace(/<[^>]*>?/gm, '');
  };

  const formatFieldName = (fieldName) => {
    let formattedField = fieldName.replace("_paragraph", "");
    return formattedField
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  useEffect(() => {
    const initialState = {};
    const localCandidateGroups = {}; // Use a local variable to avoid confusion with state

    if (duplicates && duplicates.length > 0) {
        duplicates.forEach(dupe => {
            const candidateId = dupe.duplicate_info?.duplicate_candidate?.candidateId;
            if (!candidateId) return;

            if (!localCandidateGroups[candidateId]) {
                localCandidateGroups[candidateId] = [];
            }
            localCandidateGroups[candidateId].push(dupe);
        });

        Object.values(localCandidateGroups).forEach(candidateFiles => {
            const enhancedModifiedResumes = candidateFiles.filter(dupe =>
                dupe.duplicate_info?.duplicate_type === 'MODIFIED_RESUME' &&
                dupe.duplicate_info?.resume_changes?.overall_assessment === 'enhanced'
            );

            if (enhancedModifiedResumes.length > 0) {
                enhancedModifiedResumes.sort((a, b) => {
                    const aEnrichedCount = a.duplicate_info?.resume_changes?.enriched_fields?.length || 0;
                    const bEnrichedCount = b.duplicate_info?.resume_changes?.enriched_fields?.length || 0;
                    return bEnrichedCount - aEnrichedCount;
                });
                if (enhancedModifiedResumes[0] && enhancedModifiedResumes[0].fileName) {
                    initialState[enhancedModifiedResumes[0].fileName] = true;
                }
            }
        });
    }
    setSelectedDuplicates(initialState);
  }, [duplicates]); // Rerun when duplicates prop changes

  useEffect(() => {
    const fetchMatchData = async () => {
      const newMatchData = {};
      for (const dupe of duplicates) {
        // Corrected access to duplicate_info
        if (dupe.duplicate_info && dupe.duplicate_info.duplicate_candidate && dupe.duplicate_info.duplicate_candidate.candidateId) {
          try {
            // This API endpoint might need adjustment or you might not need it if all data comes in `duplicates`
            const response = await axios.get(`/api/candidates/match-percentage/${dupe.duplicate_info.duplicate_candidate.candidateId}`);
            newMatchData[dupe.fileName] = response.data;
          } catch (error) {
            console.error(`Failed to fetch match data for ${dupe.fileName}:`, error);
            newMatchData[dupe.fileName] = {
              match_percentage: dupe.duplicate_info?.match_percentage || 0,
              confidence: dupe.duplicate_info?.confidence || 0,
              duplicate_type: dupe.duplicate_info?.duplicate_type || "UNKNOWN"
            };
          }
        } else {
          newMatchData[dupe.fileName] = {
            match_percentage: dupe.duplicate_info?.match_percentage || 0,
            confidence: dupe.duplicate_info?.confidence || 0,
            duplicate_type: dupe.duplicate_info?.duplicate_type || "UNKNOWN"
          };
        }
      }
      setMatchData(newMatchData);
    };

    if (isOpen && duplicates && duplicates.length > 0) {
      // fetchMatchData(); // You can re-enable this if needed
    }
  }, [isOpen, duplicates]);

  useEffect(() => {
    if (!duplicates || duplicates.length === 0) {
      setGroupedDuplicates([]);
      return;
    }

    const sortDuplicates = (items) => {
      return items.sort((a, b) => {
        const typeOrder = {
          'MODIFIED_RESUME': 0,
          'EXACT_DUPLICATE': 1,
          'COPIED_RESUME': 2,
          'UNKNOWN': 3
        };
        // Corrected access to duplicate_info
        const aType = a.duplicate_info?.duplicate_type || 'UNKNOWN';
        const bType = b.duplicate_info?.duplicate_type || 'UNKNOWN';

        if (aType !== bType) {
          return typeOrder[aType] - typeOrder[bType];
        }

        if (aType === 'MODIFIED_RESUME') {
          // Corrected access to duplicate_info
          const aAssessment = a.duplicate_info?.resume_changes?.overall_assessment;
          const bAssessment = b.duplicate_info?.resume_changes?.overall_assessment;

          if (aAssessment === 'enhanced' && bAssessment !== 'enhanced') return -1;
          if (aAssessment !== 'enhanced' && bAssessment === 'enhanced') return 1;
        }
        // Corrected access to duplicate_info
        const aMatch = a.duplicate_info?.match_percentage || 0;
        const bMatch = b.duplicate_info?.match_percentage || 0;
        return bMatch - aMatch;
      });
    };

    const groups = {};
    duplicates.forEach(dupe => {
      // Corrected access to duplicate_info
      const candidateId = dupe.duplicate_info?.duplicate_candidate?.candidateId;
      if (!candidateId) {
          console.warn("DuplicateModal: Skipping dupe due to missing candidateId for grouping:", dupe);
          return;
      }

      if (!groups[candidateId]) {
        // Corrected access to duplicate_info
        const candidateName = dupe.duplicate_info?.duplicate_candidate?.extractedText?.applicant_name || `Existing Candidate (${candidateId.slice(-6)})`;
        const uploadTime = dupe.duplicate_info?.duplicate_candidate?.uploadedAt || '';

        groups[candidateId] = {
          candidateId,
          candidateName,
          uploadTime,
          items: []
        };
      }
      groups[candidateId].items.push(dupe);
    });

    Object.values(groups).forEach(group => {
      group.items = sortDuplicates(group.items);
    });

    const sortedGroups = Object.values(groups).sort((a, b) => {
      const aHasEnhanced = a.items.some(item =>
        // Corrected access to duplicate_info
        item.duplicate_info?.resume_changes?.overall_assessment === 'enhanced');
      const bHasEnhanced = b.items.some(item =>
        // Corrected access to duplicate_info
        item.duplicate_info?.resume_changes?.overall_assessment === 'enhanced');

      if (aHasEnhanced && !bHasEnhanced) return -1;
      if (!aHasEnhanced && bHasEnhanced) return 1;

      return b.items.length - a.items.length; // Fallback sort by number of items
    });
    setGroupedDuplicates(sortedGroups);
  }, [duplicates]);

  useEffect(() => {
    if (groupedDuplicates.length > 0) {
      const initialExpandedState = {};
      groupedDuplicates.forEach((group, index) => {
        initialExpandedState[group.candidateId || index] = true; // Use candidateId as key if available, else index
      });
      setExpandedGroups(initialExpandedState);
    } else {
      setExpandedGroups({});
    }
  }, [groupedDuplicates]);

  const handleToggleSelection = (fileName, groupKey) => { // groupKey can be candidateId or index
    setSelectedDuplicates(prev => {
      const newState = { ...prev };
      const group = groupedDuplicates.find(g => (g.candidateId || groupedDuplicates.indexOf(g)) === groupKey);

      if (!prev[fileName]) { // If checking the box
        if (group) {
          group.items.forEach(item => {
            if (item.fileName !== fileName && newState[item.fileName]) {
              newState[item.fileName] = false; // Uncheck others in the same group
            }
          });
        }
        newState[fileName] = true;
      } else { // If unchecking the box
        newState[fileName] = false;
      }
      return newState;
    });
  };

  const handleOverwriteWithSelected = () => {
    const selectedFiles = Object.keys(selectedDuplicates).filter(
      fileName => selectedDuplicates[fileName]
    );
    onProceed(selectedFiles);
  };

  const handleCancelUpload = () => {
    onClose('closeAll');
  };

  const toggleGroupExpansion = (groupKey, event) => { // groupKey can be candidateId or index
    event.stopPropagation();
    setExpandedGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  const getDuplicateTypeLabel = (type) => {
    switch (type) {
      case 'EXACT_DUPLICATE':
        return { text: 'Exact Duplicate', className: 'duplicate-type-exact' };
      case 'MODIFIED_RESUME':
        return { text: 'Modified Version', className: 'duplicate-type-updated' };
      case 'COPIED_RESUME':
        return { text: 'Copied Content', className: 'duplicate-type-copied' };
      case 'DUPLICATE_RESUME': // Keep if backend might send this
        return { text: 'Duplicate', className: 'duplicate-type-exact' };
      default:
        return { text: 'Potential Match', className: 'duplicate-type-similar' };
    }
  };

  const getConfidenceLabel = (confidence, matchPercentage, type) => {
    const matchPercent = isNaN(matchPercentage) || matchPercentage === undefined ? 0 : Math.round(matchPercentage);

    if (type === "EXACT_DUPLICATE") {
      return `${matchPercent}% Match`;
    } else if (type === "MODIFIED_RESUME") {
      return `${matchPercent}% Content Match`;
    } else if (type === "COPIED_RESUME") {
      return `${matchPercent}% Copied Content`;
    } else {
      return `${matchPercent}% Match`;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString(); // Or any other format you prefer
    } catch (e) {
      return dateString; // Fallback if date is invalid
    }
  };

  const getCandidateSummary = (candidate) => {
    if (!candidate) return 'No candidate information available';

    if (candidate.detailed_profile && candidate.detailed_profile.summary) {
      return sanitizeHTML(candidate.detailed_profile.summary);
    }

    if (candidate.extractedText) {
      const extractedText = candidate.extractedText;
      const namePart = extractedText.applicant_name ? `${extractedText.applicant_name}` : '';
      const bioPart = extractedText.bio ? ` - ${sanitizeHTML(extractedText.bio.substring(0, 100))}${extractedText.bio.length > 100 ? '...' : ''}` : '';
      const skillsPart = extractedText.technical_skills ? `Skills: ${Array.isArray(extractedText.technical_skills) ? extractedText.technical_skills.join(', ') : sanitizeHTML(String(extractedText.technical_skills).substring(0,80))}` : '';


      let summary = [namePart, bioPart, skillsPart].filter(Boolean).join(' ').trim();
      return summary || 'Basic candidate information extracted.';
    }

    return 'Previously uploaded candidate';
  };

  const getChangeAssessmentClass = (assessment) => {
    switch (assessment) {
      case 'enhanced':
        return 'assessment-enhanced';
      case 'degraded':
        return 'assessment-degraded';
      default:
        return 'assessment-neutral';
    }
  };

  const toggleChangeExpansion = (changeKey) => { // Use a unique key like `${groupKey}-${itemIndex}`
    setExpandedChanges(prev => ({
      ...prev,
      [changeKey]: !prev[changeKey]
    }));
  };

  const anySelected = Object.values(selectedDuplicates).some(value => value);

  if (!isOpen) return null;

  return (
    <div
      className="duplicate-modal-overlay"
      onClick={(e) => e.stopPropagation()} // Prevent modal close on overlay click if not desired
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-modal-title"
    >
      <div className="duplicate-modal-content">
        <div className="duplicate-modal-header">
          <h2 id="duplicate-modal-title" className="duplicate-modal-title">
            Duplicate / Modified / Spam Files Detected
          </h2>
          <button
            className="duplicate-modal-close"
            onClick={() => onClose()} // Simple close, or handleCancelUpload if confirmation needed
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="duplicate-modal-body">
          <div className="duplicate-modal-warning">
            <div className="duplicate-modal-warning-title">
              <span className="duplicate-modal-warning-icon">⚠️</span>
              Attention Required
            </div>
            <p className="duplicate-modal-warning-text">
              The system has detected {duplicates.length === 1 ? "a potential duplicate / modified or spam file" : "potential duplicate / modified or spam files"}. Please review the information below and select which files you wish to upload.
            </p>
          </div>

          {groupedDuplicates.length === 0 && duplicates && duplicates.length > 0 ? (
            <div className="duplicate-empty-state">
              <div className="duplicate-empty-icon">⚠️</div>
              <h3 className="duplicate-empty-title">Grouping Error</h3>
              <p className="duplicate-empty-text">Could not group duplicate files. Please check console and data structure.</p>
            </div>
          ) : (!duplicates || duplicates.length === 0) ? (
             <div className="duplicate-empty-state">
                <div className="duplicate-empty-icon">📄</div>
                <h3 className="duplicate-empty-title">No duplicates found</h3>
                <p className="duplicate-empty-text">All files are unique and ready to be processed.</p>
             </div>
          ) : (
            <div className="duplicate-files-list">
              {groupedDuplicates.map((group, groupIndex) => {
                const groupKey = group.candidateId || groupIndex; // Use candidateId if available for stability
                const isExpanded = !!expandedGroups[groupKey];
                const firstDupe = group.items[0];
                // Corrected access to duplicate_info
                const dupCandidate = firstDupe?.duplicate_info?.duplicate_candidate;

                return (
                  <div key={`group-${groupKey}`} className="duplicate-group">
                    <div
                      className={`duplicate-group-header ${isExpanded ? 'expanded' : 'collapsed'}`}
                      onClick={(e) => toggleGroupExpansion(groupKey, e)}
                      aria-expanded={isExpanded}
                      aria-controls={`group-content-${groupKey}`}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="duplicate-group-header-content">
                        <span className="duplicate-group-title">
                          Matches with {group.candidateId || `Existing Candidate ${groupKey}`}
                          <span className="expand-icon"></span> {/* CSS will handle +/- or chevron */}
                        </span>
                        <div className="duplicate-group-info">
                          {group.uploadTime && (
                            <span className="duplicate-group-upload-time">
                              Uploaded at {formatDate(group.uploadTime)}
                            </span>
                          )}
                          <span className="duplicate-group-count">
                            {group.items.length} {group.items.length === 1 ? 'file' : 'files'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {dupCandidate && (
                      <div className="duplicate-details-item full-width candidate-summary-container">
                        <div className="duplicate-details-label">CANDIDATE SUMMARY:</div>
                        <div className="duplicate-details-value summary-scrollable">
                          <span className="summary-content">{getCandidateSummary(dupCandidate)}</span>
                        </div>
                      </div>
                    )}

                    <div
                      id={`group-content-${groupKey}`}
                      className={`duplicate-group-content ${isExpanded ? 'expanded' : 'collapsed'}`}
                    >
                      {isExpanded && group.items.map((dupe, itemIndex) => {
                        // Corrected access to duplicate_info for all these
                        const dupInfo = dupe.duplicate_info;
                        const backendType = dupInfo?.duplicate_type || "UNKNOWN";
                        const typeDisplayInfo = getDuplicateTypeLabel(backendType);
                        const newFileAnalysis = dupe.duplicate_info?.new_file_analysis;
                        const newFileExternalAIPred = newFileAnalysis?.externalAIDetectionResult;

                        const currentMatchInfo = matchData[dupe.fileName] || {
                          confidence: dupInfo?.confidence || 0,
                          match_percentage: dupInfo?.match_percentage || 0,
                          duplicate_type: backendType
                        };

                        const confidence = currentMatchInfo.confidence;
                        const matchPercentage = currentMatchInfo.match_percentage;
                        const resumeChanges = dupInfo?.resume_changes;
                        const changeKey = `${groupKey}-${itemIndex}`;
                        const isChangeExpanded = !!expandedChanges[changeKey];

                        const isFirstInGroup = itemIndex === 0;
                        const isLastInGroup = itemIndex === group.items.length - 1;

                        return (
                          <div
                            key={`${groupKey}-${itemIndex}-${dupe.fileName}`}
                            className={`duplicate-file-item ${isFirstInGroup ? 'first-in-group' : ''} ${isLastInGroup ? 'last-in-group' : ''}`}
                          >
                            <div className="duplicate-file-content">
                              <div className="duplicate-file-header">
                                <div className="duplicate-file-name-container">
                                  <span className={`duplicate-file-name ${(backendType === 'EXACT_DUPLICATE' ||
                                    (backendType === 'MODIFIED_RESUME' &&
                                    resumeChanges?.overall_assessment === 'neutral')) ? 'no-checkbox' : ''}`} title={dupe.fileName}>
                                    {(backendType !== 'EXACT_DUPLICATE' &&
                                      !(backendType === 'MODIFIED_RESUME' &&
                                        resumeChanges?.overall_assessment === 'neutral')) ? (
                                      <input
                                        type="checkbox"
                                        className="duplicate-file-checkbox"
                                        id={`duplicate-file-${groupKey}-${itemIndex}`}
                                        checked={!!selectedDuplicates[dupe.fileName]}
                                        onChange={() => handleToggleSelection(dupe.fileName, groupKey)}
                                        aria-label={`Select ${dupe.fileName}`}
                                      />
                                    ) : null}
                                    {dupe.fileName}
                                  </span>
                                  <span className="duplicate-confidence">
                                    {getConfidenceLabel(confidence, matchPercentage, backendType)}
                                  </span>
                                </div>
                                <span className={`duplicate-file-type ${typeDisplayInfo.className}`}>
                                  {typeDisplayInfo.text}
                                </span>
                              </div>

                              {backendType === 'MODIFIED_RESUME' && resumeChanges && (
                                <div className="resume-changes-section">
                                  <div
                                    className={`resume-changes-header ${isChangeExpanded ? 'expanded' : ''}`}
                                    onClick={() => toggleChangeExpansion(changeKey)}
                                  >
                                    <h4 className="resume-changes-title">
                                      Resume Changes Detected
                                      <span className="resume-changes-expand-icon">
                                        {isChangeExpanded ? '-' : '+'}
                                      </span>
                                    </h4>
                                    {resumeChanges.overall_assessment && (
                                      <span className={`resume-change-assessment ${getChangeAssessmentClass(resumeChanges.overall_assessment)}`}>
                                        {resumeChanges.overall_assessment}
                                      </span>
                                    )}
                                  </div>

                                  {isChangeExpanded && (
                                    <>
                                      {resumeChanges.detailed_changes && (
                                        <p className="resume-changes-description">{resumeChanges.detailed_changes}</p>
                                      )}

                                      {resumeChanges.enriched_fields && resumeChanges.enriched_fields.length > 0 && (
                                        <div className="resume-change-item enriched">
                                          <span className="resume-change-label">New/Modified Content:</span>
                                          <div className="resume-change-values">
                                            {resumeChanges.enriched_fields.map((field, i) => (
                                              <span key={i} className="resume-change-value">{formatFieldName(field)}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {resumeChanges.reduced_fields && resumeChanges.reduced_fields.length > 0 && (
                                        <div className="resume-change-item reduced">
                                          <span className="resume-change-label">Removed Content:</span>
                                          <div className="resume-change-values">
                                            {resumeChanges.reduced_fields.map((field, i) => (
                                              <span key={i} className="resume-change-value">{formatFieldName(field)}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}

                                      {(!resumeChanges.enriched_fields || resumeChanges.enriched_fields.length === 0) &&
                                      (!resumeChanges.reduced_fields || resumeChanges.reduced_fields.length === 0) && (
                                        <p className="resume-no-changes">Minor changes detected, but no significant content differences.</p>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}

                              {/* Existing Internal Analysis Summary */}
                              {newFileAnalysis.finalXAISummary && (
                                  <p className="new-file-xai-summary">
                                      <strong>Internal AI Assessment:</strong> {newFileAnalysis.finalXAISummary}
                                  </p>
                              )}
                              <div className="new-file-scores">
                                  {newFileAnalysis.overallAuthenticityScore !== null && newFileAnalysis.overallAuthenticityScore !== undefined && (
                                      <span className="new-file-score-tag authenticity">
                                          Internal Auth: {(newFileAnalysis.overallAuthenticityScore * 100).toFixed(0)}%
                                      </span>
                                  )}
                                  {newFileAnalysis.spamLikelihoodScore !== null && newFileAnalysis.spamLikelihoodScore !== undefined && (
                                      <span className="new-file-score-tag spam">
                                          Internal Spam: {(newFileAnalysis.spamLikelihoodScore * 100).toFixed(0)}%
                                      </span>
                                  )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="duplicate-modal-footer">
          <button
            className="duplicate-modal-button duplicate-secondary-button"
            onClick={handleCancelUpload}
          >
            Cancel Upload
          </button>

          {nonDuplicateCount > 0 && (
            <button
              className="duplicate-modal-button duplicate-non-duplicate-button"
              onClick={onUploadNonDuplicates}
            >
              Upload {nonDuplicateCount} Non-Duplicate{nonDuplicateCount !== 1 ? 's' : ''} Only
            </button>
          )}

          <button
            className="duplicate-modal-button duplicate-primary-button"
            onClick={handleOverwriteWithSelected}
            disabled={!anySelected && duplicates && duplicates.length > 0}
          >
            {duplicates && duplicates.length > 0
              ? `Overwrite With Selected (${Object.values(selectedDuplicates).filter(Boolean).length})${nonDuplicateCount > 0 ? ' + Non-Duplicates' : ''}`
              : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateFilesModal;
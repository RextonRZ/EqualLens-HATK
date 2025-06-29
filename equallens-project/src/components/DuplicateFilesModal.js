import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './DuplicateFilesModal.css';

const DuplicateFilesModal = ({ isOpen, duplicates, onClose, onProceed, onUploadNonDuplicates, nonDuplicateCount }) => {
  const [selectedDuplicates, setSelectedDuplicates] = useState({});
  const [matchData, setMatchData] = useState({});
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
    const localCandidateGroups = {};

    if (duplicates && duplicates.length > 0) {
      duplicates.forEach(dupe => {
        // FIXED: Use correct path for candidate ID
        const candidateId = dupe.duplicate_candidate?.candidateId;
        if (!candidateId) return;

        if (!localCandidateGroups[candidateId]) {
          localCandidateGroups[candidateId] = [];
        }
        localCandidateGroups[candidateId].push(dupe);
      });

      Object.values(localCandidateGroups).forEach(candidateFiles => {
        const enhancedModifiedResumes = candidateFiles.filter(dupe =>
          dupe.duplicate_type === 'MODIFIED_RESUME' &&
          dupe.resume_changes?.overall_assessment === 'enhanced'
        );

        if (enhancedModifiedResumes.length > 0) {
          enhancedModifiedResumes.sort((a, b) => {
            const aEnrichedCount = a.resume_changes?.enriched_fields?.length || 0;
            const bEnrichedCount = b.resume_changes?.enriched_fields?.length || 0;
            return bEnrichedCount - aEnrichedCount;
          });

          // FIXED: Use correct field name
          if (enhancedModifiedResumes[0] && enhancedModifiedResumes[0].fileName) {
            initialState[enhancedModifiedResumes[0].fileName] = true;
          }
        }
      });
    }
    setSelectedDuplicates(initialState);
  }, [duplicates]);

  useEffect(() => {
    const fetchMatchData = async () => {
      const newMatchData = {};
      for (const dupe of duplicates) {
        // FIXED: Use correct path
        if (dupe.duplicate_candidate && dupe.duplicate_candidate.candidateId) {
          try {
            const response = await axios.get(`/api/candidates/match-percentage/${dupe.duplicate_candidate.candidateId}`);
            newMatchData[dupe.fileName] = response.data;
          } catch (error) {
            console.error(`Failed to fetch match data for ${dupe.fileName}:`, error);
            newMatchData[dupe.fileName] = {
              match_percentage: dupe.match_percentage || 0,
              confidence: dupe.confidence || 0,
              duplicate_type: dupe.duplicate_type || "UNKNOWN"
            };
          }
        } else {
          newMatchData[dupe.fileName] = {
            match_percentage: dupe.match_percentage || 0,
            confidence: dupe.confidence || 0,
            duplicate_type: dupe.duplicate_type || "UNKNOWN"
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
          'EXACT_DUPLICATE': 1,
          'MODIFIED_RESUME': 2,
          'COPIED_RESUME': 3,
          'UNKNOWN': 4
        };

        const aType = a.duplicate_type || 'UNKNOWN';
        const bType = b.duplicate_type || 'UNKNOWN';

        if (aType !== bType) {
          return (typeOrder[aType] || 5) - (typeOrder[bType] || 5);
        }

        if (aType === 'MODIFIED_RESUME') {
          const aAssessment = a.resume_changes?.overall_assessment;
          const bAssessment = b.resume_changes?.overall_assessment;

          const assessmentOrder = { 'enhanced': 1, 'neutral': 2, 'degraded': 3 };
          const aOrder = assessmentOrder[aAssessment] || 4;
          const bOrder = assessmentOrder[bAssessment] || 4;

          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
        }

        const aMatch = a.match_percentage || 0;
        const bMatch = b.match_percentage || 0;
        return bMatch - aMatch;
      });
    };

    const groups = {};
    duplicates.forEach(dupe => {
      const candidateId = dupe.duplicate_candidate?.candidateId;
      if (!candidateId) {
        console.warn("DuplicateModal: Skipping dupe due to missing candidateId for grouping:", dupe);
        return;
      }

      if (!groups[candidateId]) {
        const candidateDisplayName = `${candidateId}`;
        const uploadTime = dupe.duplicate_candidate?.uploadedAt || '';

        groups[candidateId] = {
          candidateId,
          candidateName: candidateDisplayName, // Use anonymous display name
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
        item.resume_changes?.overall_assessment === 'enhanced');
      const bHasEnhanced = b.items.some(item =>
        item.resume_changes?.overall_assessment === 'enhanced');

      if (aHasEnhanced && !bHasEnhanced) return -1;
      if (!aHasEnhanced && bHasEnhanced) return 1;
      return 0;
    });

    setGroupedDuplicates(sortedGroups);
  }, [duplicates]);

  useEffect(() => {
    if (groupedDuplicates.length > 0) {
      const initialExpandedState = {};
      groupedDuplicates.forEach((group, index) => {
        initialExpandedState[group.candidateId || index] = true;
      });
      setExpandedGroups(initialExpandedState);
    } else {
      setExpandedGroups({});
    }
  }, [groupedDuplicates]);

  const handleToggleSelection = (fileNameToToggle, groupKey) => {
    setSelectedDuplicates(prevSelected => {
      const newSelectedState = { ...prevSelected };
      const targetGroup = groupedDuplicates.find(g => (g.candidateId || groupedDuplicates.indexOf(g)) === groupKey);

      if (!prevSelected[fileNameToToggle]) {
        if (targetGroup && targetGroup.items) {
          targetGroup.items.forEach(item => {
            // FIXED: Use correct field name
            if (item.fileName !== fileNameToToggle) {
              newSelectedState[item.fileName] = false;
            }
          });
        }
        newSelectedState[fileNameToToggle] = true;
      } else {
        newSelectedState[fileNameToToggle] = false;
      }
      return newSelectedState;
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

  const toggleGroupExpansion = (groupKey, event) => {
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
      case 'DUPLICATE_RESUME':
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
      return date.toLocaleString();
    } catch (e) {
      return dateString;
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
      const skillsPart = extractedText.technical_skills ? `Skills: ${Array.isArray(extractedText.technical_skills) ? extractedText.technical_skills.join(', ') : sanitizeHTML(String(extractedText.technical_skills).substring(0, 50))}` : '';

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
      case 'mixed changes':
        return 'assessment-mixed';
      default:
        return 'assessment-neutral';
    }
  };

  const toggleChangeExpansion = (changeKey) => {
    setExpandedChanges(prev => ({
      ...prev,
      [changeKey]: !prev[changeKey]
    }));
  };

  const anySelected = Object.values(selectedDuplicates).some(value => value);

  const getSelectedDuplicateTypes = () => {
    const selectedFiles = Object.keys(selectedDuplicates).filter(fileName => selectedDuplicates[fileName]);
    const selectedTypes = new Set();

    groupedDuplicates.forEach(group => {
      group.items.forEach(item => {
        // FIXED: Use correct field name
        if (selectedFiles.includes(item.fileName)) {
          const duplicateType = item.duplicate_type || "UNKNOWN";
          selectedTypes.add(duplicateType);
        }
      });
    });

    return selectedTypes;
  };

  const selectedTypes = getSelectedDuplicateTypes();
  const allSelectedAreCopied = selectedTypes.size === 1 && selectedTypes.has('COPIED_RESUME');

  if (!isOpen) return null;

  return (
    <div
      className="duplicate-modal-overlay"
      onClick={(e) => e.stopPropagation()}
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
            onClick={() => onClose()}
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
              The system has detected {duplicates.length === 1 ? "a potential duplicate / modified or spam file" : "potential duplicate / modified or spam files"}. Please review the information below and choose how to proceed.
            </p>
          </div>

          {groupedDuplicates.length === 0 && duplicates && duplicates.length > 0 ? (
            <div className="duplicate-empty-state">
              <div className="duplicate-empty-icon">⚠️</div>
              <h3 className="duplicate-empty-title">Grouping Error</h3>
              <p className="duplicate-empty-text">Could not group duplicate files. Please check console and data structure.</p>
              <pre style={{fontSize: '12px', textAlign: 'left', maxHeight: '200px', overflow: 'auto'}}>
                {JSON.stringify(duplicates[0], null, 2)}
              </pre>
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
                const groupKey = group.candidateId || groupIndex;
                const isExpanded = !!expandedGroups[groupKey];
                const firstDupe = group.items[0];
                // FIXED: Use correct path
                const dupCandidate = firstDupe?.duplicate_candidate;

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
                          Matches with {group.candidateName || `Existing Candidate ${groupKey}`}
                          <span className="expand-icon"></span>
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
                        const backendType = dupe.duplicate_type || "UNKNOWN";
                        const typeDisplayInfo = getDuplicateTypeLabel(backendType);

                        // FIXED: Use correct field names
                        const currentMatchInfo = matchData[dupe.fileName] || {
                          confidence: dupe.confidence || 0,
                          match_percentage: dupe.match_percentage || 0,
                          duplicate_type: backendType
                        };

                        const confidence = currentMatchInfo.confidence;
                        const matchPercentage = currentMatchInfo.match_percentage;
                        const resumeChanges = dupe.resume_changes; // FIXED: Use correct field

                        const changeKey = `${groupKey}-${itemIndex}`;
                        const isChangeExpanded = !!expandedChanges[changeKey];

                        const isFirstInGroup = itemIndex === 0;
                        const isLastInGroup = itemIndex === group.items.length - 1;

                        return (
                          <div
                            key={`${groupKey}-${itemIndex}-${dupe.fileName}`} // FIXED: Use correct field
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
                                        checked={!!selectedDuplicates[dupe.fileName]} // FIXED: Use correct field
                                        onChange={() => handleToggleSelection(dupe.fileName, groupKey)} // FIXED: Use correct field
                                        aria-label={`Select ${dupe.fileName}`} // FIXED: Use correct field
                                      />
                                    ) : null}
                                    {dupe.fileName} {/* FIXED: Use correct field */}
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
              ? allSelectedAreCopied 
                ? `Continue to Upload (${Object.values(selectedDuplicates).filter(Boolean).length})${nonDuplicateCount > 0 ? ' + Non-Duplicates' : ''}`
                : `Overwrite With Selected (${Object.values(selectedDuplicates).filter(Boolean).length})${nonDuplicateCount > 0 ? ' + Non-Duplicates' : ''}`
              : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DuplicateFilesModal;
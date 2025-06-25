import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Keep if you plan to use fetchMatchData later
import './DuplicateFilesModal.css';

const DuplicateFilesModal = ({ isOpen, duplicates, onClose, onProceed, onUploadNonDuplicates }) => {
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
          const candidateId = dupe.existing_candidate_details?.candidateId; // Corrected: For grouping logic if needed here
          if (!candidateId) return;

          if (!localCandidateGroups[candidateId]) {
              localCandidateGroups[candidateId] = [];
          }
          localCandidateGroups[candidateId].push(dupe);
      });

      Object.values(localCandidateGroups).forEach(candidateFiles => {
          const enhancedModifiedResumes = candidateFiles.filter(dupe =>
              // dupe.duplicate_info?.duplicate_type === 'MODIFIED_RESUME' && // Old
              // dupe.duplicate_info?.resume_changes?.overall_assessment === 'enhanced' // Old
              dupe.duplicate_type === 'MODIFIED_RESUME' && // Corrected
              dupe.resume_changes_if_modified?.overall_assessment === 'enhanced' // Corrected
          );

          if (enhancedModifiedResumes.length > 0) {
              enhancedModifiedResumes.sort((a, b) => {
                  // const aEnrichedCount = a.duplicate_info?.resume_changes?.enriched_fields?.length || 0; // Old
                  // const bEnrichedCount = b.duplicate_info?.resume_changes?.enriched_fields?.length || 0; // Old
                  const aEnrichedCount = a.resume_changes_if_modified?.enriched_fields?.length || 0; // Corrected
                  const bEnrichedCount = b.resume_changes_if_modified?.enriched_fields?.length || 0; // Corrected
                  return bEnrichedCount - aEnrichedCount;
              });
              // if (enhancedModifiedResumes[0] && enhancedModifiedResumes[0].fileName) { // Old
              //     initialState[enhancedModifiedResumes[0].fileName] = true; // Old
              // }
              if (enhancedModifiedResumes[0] && enhancedModifiedResumes[0].new_file_name) { // Corrected
                  initialState[enhancedModifiedResumes[0].new_file_name] = true; // Corrected
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
        if (dupe.existing_candidate_details && dupe.existing_candidate_details.candidateId) { // Corrected
          try {
            // const response = await axios.get(`/api/candidates/match-percentage/${dupe.duplicate_info.duplicate_candidate.candidateId}`); // Old
            const response = await axios.get(`/api/candidates/match-percentage/${dupe.existing_candidate_details.candidateId}`); // Corrected
            // newMatchData[dupe.fileName] = response.data; // Old
            newMatchData[dupe.new_file_name] = response.data; // Corrected
          } catch (error) {
            // console.error(`Failed to fetch match data for ${dupe.fileName}:`, error); // Old
            console.error(`Failed to fetch match data for ${dupe.new_file_name}:`, error); // Corrected
            // newMatchData[dupe.fileName] = { // Old
            newMatchData[dupe.new_file_name] = { // Corrected
              // match_percentage: dupe.duplicate_info?.match_percentage || 0, // Old
              // confidence: dupe.duplicate_info?.confidence || 0, // Old
              // duplicate_type: dupe.duplicate_info?.duplicate_type || "UNKNOWN" // Old
              match_percentage: dupe.match_percentage || 0, // Corrected
              confidence: dupe.confidence || 0, // Corrected
              duplicate_type: dupe.duplicate_type || "UNKNOWN" // Corrected
            };
          }
        } else {
          // newMatchData[dupe.fileName] = { // Old
          newMatchData[dupe.new_file_name] = { // Corrected
            // match_percentage: dupe.duplicate_info?.match_percentage || 0, // Old
            // confidence: dupe.duplicate_info?.confidence || 0, // Old
            // duplicate_type: dupe.duplicate_info?.duplicate_type || "UNKNOWN" // Old
            match_percentage: dupe.match_percentage || 0, // Corrected
            confidence: dupe.confidence || 0, // Corrected
            duplicate_type: dupe.duplicate_type || "UNKNOWN" // Corrected
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
    const typeOrder = { /* ... */ };
    // const aType = a.duplicate_info?.duplicate_type || 'UNKNOWN'; // Old
    // const bType = b.duplicate_info?.duplicate_type || 'UNKNOWN'; // Old
    const aType = a.duplicate_type || 'UNKNOWN'; // Corrected
    const bType = b.duplicate_type || 'UNKNOWN'; // Corrected

    if (aType !== bType) { /* ... */ }

    if (aType === 'MODIFIED_RESUME') {
      // const aAssessment = a.duplicate_info?.resume_changes?.overall_assessment; // Old
      // const bAssessment = b.duplicate_info?.resume_changes?.overall_assessment; // Old
      const aAssessment = a.resume_changes_if_modified?.overall_assessment; // Corrected
      const bAssessment = b.resume_changes_if_modified?.overall_assessment; // Corrected
      /* ... */
    }
    // const aMatch = a.duplicate_info?.match_percentage || 0; // Old
    // const bMatch = b.duplicate_info?.match_percentage || 0; // Old
    const aMatch = a.match_percentage || 0; // Corrected
    const bMatch = b.match_percentage || 0; // Corrected
    return bMatch - aMatch;
  });
};

const groups = {};
  duplicates.forEach(dupe => {
    // const candidateId = dupe.duplicate_info?.duplicate_candidate?.candidateId; // Old: THIS IS THE MAIN CAUSE OF GROUPING ERROR
    const candidateId = dupe.existing_candidate_details?.candidateId; // Corrected
    if (!candidateId) {
        console.warn("DuplicateModal: Skipping dupe due to missing candidateId for grouping:", dupe);
        return;
    }

    if (!groups[candidateId]) {
      // const candidateName = dupe.duplicate_info?.duplicate_candidate?.extractedText?.applicant_name || `Existing Candidate (${candidateId.slice(-6)})`; // Old
      // const uploadTime = dupe.duplicate_info?.duplicate_candidate?.uploadedAt || ''; // Old
      
      // Corrected: Assumes your Python backend now includes these in `existing_candidate_details`
      const candidateName = dupe.existing_candidate_details?.applicant_name || `Existing Candidate (${candidateId.slice(-6)})`; // Corrected
      const uploadTime = dupe.existing_candidate_details?.uploadedAt || ''; // Corrected

      groups[candidateId] = { candidateId, candidateName, uploadTime, items: [] };
    }
    groups[candidateId].items.push(dupe);
  });

  Object.values(groups).forEach(group => { group.items = sortDuplicates(group.items); });

  const sortedGroups = Object.values(groups).sort((a, b) => {
    const aHasEnhanced = a.items.some(item =>
      // item.duplicate_info?.resume_changes?.overall_assessment === 'enhanced'); // Old
      item.resume_changes_if_modified?.overall_assessment === 'enhanced'); // Corrected
    const bHasEnhanced = b.items.some(item =>
      // item.duplicate_info?.resume_changes?.overall_assessment === 'enhanced'); // Old
      item.resume_changes_if_modified?.overall_assessment === 'enhanced'); // Corrected
    /* ... */
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

  const handleToggleSelection = (fileNameToToggle, groupKey) => {
    setSelectedDuplicates(prevSelected => {
      const newSelectedState = { ...prevSelected };
      const targetGroup = groupedDuplicates.find(g => (g.candidateId || groupedDuplicates.indexOf(g)) === groupKey);

      // If checking the new item
      if (!prevSelected[fileNameToToggle]) {
        // Uncheck all other items in the same group
        if (targetGroup && targetGroup.items) {
          targetGroup.items.forEach(item => {
            if (item.new_file_name !== fileNameToToggle) { // Use new_file_name for comparison
              newSelectedState[item.new_file_name] = false; // Use new_file_name to uncheck
            }
          });
        }
        // Check the toggled item
        newSelectedState[fileNameToToggle] = true;
      } else {
        // If unchecking the item, just uncheck it
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

  // Determine if all selected files are "Copied Content" type
  const getSelectedDuplicateTypes = () => {
    const selectedFiles = Object.keys(selectedDuplicates).filter(fileName => selectedDuplicates[fileName]);
    const selectedTypes = new Set();
    
    groupedDuplicates.forEach(group => {
      group.items.forEach(item => {
        if (selectedFiles.includes(item.new_file_name)) { // Corrected: use new_file_name
          const duplicateType = item.duplicate_type || "UNKNOWN"; // Corrected: access duplicate_type directly
          selectedTypes.add(duplicateType);
        }
      });
    });
    
    return selectedTypes;
  };

  const selectedTypes = getSelectedDuplicateTypes();
  const allSelectedAreCopied = selectedTypes.size === 1 && selectedTypes.has('COPIED_RESUME');

  const calculateNonDuplicateCount = (duplicates) => {
    console.log('Duplicates array:', duplicates); // Log the structure of duplicates
    return duplicates.filter(dupe => {
      const assessment = dupe.resume_changes_if_modified?.overall_assessment;
      const duplicateType = dupe.duplicate_type;
      console.log('Assessment for file:', dupe.new_file_name, 'is', assessment, 'and duplicate type is', duplicateType); // Log the assessment and duplicate type
      return assessment !== 'mixed changes' && assessment !== 'enhanced' && duplicateType !== 'EXACT_DUPLICATE';
    }).length;
  };

  const nonDuplicateCount = calculateNonDuplicateCount(duplicates);

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
                const dupCandidate = firstDupe?.existing_candidate_details;

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
                        // Access properties directly from the 'dupe' object
                        const backendType = dupe.duplicate_type || "UNKNOWN";
                        const typeDisplayInfo = getDuplicateTypeLabel(backendType);
                        const newFileAnalysis = dupe.new_file_analysis; // Direct access
                        // const newFileExternalAIPred = newFileAnalysis?.externalAIDetectionResult; // This is fine

                        // Ensure matchData is keyed by new_file_name if you use fetchMatchData
                        // For now, it correctly falls back to direct properties from 'dupe'
                        const currentMatchInfo = matchData[dupe.new_file_name] || {
                          confidence: dupe.confidence || 0, // Direct access
                          match_percentage: dupe.match_percentage || 0, // Direct access
                          duplicate_type: backendType
                        };

                        const confidence = currentMatchInfo.confidence;
                        const matchPercentage = currentMatchInfo.match_percentage;
                        const resumeChanges = dupe.resume_changes_if_modified; // Use new key and direct access

                        const changeKey = `${groupKey}-${itemIndex}`;
                        const isChangeExpanded = !!expandedChanges[changeKey];

                        const isFirstInGroup = itemIndex === 0;
                        const isLastInGroup = itemIndex === group.items.length - 1;

                        return (
                          <div
                            key={`${groupKey}-${itemIndex}-${dupe.new_file_name}`} // USE new_file_name
                            className={`duplicate-file-item ${isFirstInGroup ? 'first-in-group' : ''} ${isLastInGroup ? 'last-in-group' : ''}`}
                          >
                            <div className="duplicate-file-content">
                              <div className="duplicate-file-header">
                                <div className="duplicate-file-name-container">
                                  <span className={`duplicate-file-name ${(backendType === 'EXACT_DUPLICATE' ||
                                    (backendType === 'MODIFIED_RESUME' &&
                                    resumeChanges?.overall_assessment === 'neutral')) ? 'no-checkbox' : ''}`} title={dupe.new_file_name} /* USE new_file_name */>
                                    {(backendType !== 'EXACT_DUPLICATE' &&
                                      !(backendType === 'MODIFIED_RESUME' &&
                                        resumeChanges?.overall_assessment === 'neutral')) ? (
                                      <input
                                        type="checkbox"
                                        className="duplicate-file-checkbox"
                                        id={`duplicate-file-${groupKey}-${itemIndex}`}
                                        checked={!!selectedDuplicates[dupe.new_file_name]} // USE new_file_name
                                        onChange={() => handleToggleSelection(dupe.new_file_name, groupKey)} // USE new_file_name
                                        aria-label={`Select ${dupe.new_file_name}`} // USE new_file_name
                                      />
                                    ) : null}
                                    {dupe.new_file_name} {/* USE new_file_name */}
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

                              {/* This section for new file analysis scores was already correct in your latest file,
                                  but it depends on `newFileAnalysis` being correctly defined above. */}
                              {newFileAnalysis?.final_assessment_data?.finalXAISummary && (
                                  <p className="new-file-xai-summary">
                                      <strong>Internal AI Assessment:</strong> {newFileAnalysis.final_assessment_data.finalXAISummary}
                                  </p>
                              )}
                              <div className="new-file-scores">
                                  {newFileAnalysis?.final_assessment_data?.final_overall_authenticity_score !== null && newFileAnalysis?.final_assessment_data?.final_overall_authenticity_score !== undefined && (
                                      <span className="new-file-score-tag authenticity">
                                          Internal Auth: {(newFileAnalysis.final_assessment_data.final_overall_authenticity_score * 100).toFixed(0)}%
                                      </span>
                                  )}
                                  {newFileAnalysis?.final_assessment_data?.final_spam_likelihood_score !== null && newFileAnalysis?.final_assessment_data?.final_spam_likelihood_score !== undefined && (
                                      <span className="new-file-score-tag spam">
                                          Internal Spam: {(newFileAnalysis.final_assessment_data.final_spam_likelihood_score * 100).toFixed(0)}%
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
          )}          <button
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
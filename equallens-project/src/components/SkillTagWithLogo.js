// src/components/SkillTagWithLogo.js
import React from 'react';
import { getSkillVisuals } from '../utils/skillVisuals';
import './SkillTagWithLogo.css'; // Styles for this component (default purple theme)

const SkillTagWithLogo = ({ skillName, children, unstyled = false }) => {
  const visuals = getSkillVisuals(skillName);
  
  let tagClassName = `skill-tag-with-logo-component ${!visuals.logo ? 'no-logo' : ''}`;
  if (unstyled) {
    tagClassName += ' unstyled'; 
  }

  // Style object will be empty if unstyled, allowing CSS to take over
  const inlineTagStyle = !unstyled ? {
    // These are the default purple theme colors
    backgroundColor: '#f8f0ff',
    color: '#8250c8',
  } : {};

  if (skillName === "None specified") {
    // If "None specified" and unstyled, let parent CSS handle it
    if (unstyled) {
        return ( <span className={`${tagClassName} fallback-text-only`}>{skillName}</span> );
    }
    // Otherwise, apply its own default purple fallback style
    return (
      <span 
        className={`${tagClassName} fallback-tag`} // fallback-tag may have different default bg/color if needed
        style={!unstyled ? { // Apply default fallback style if not unstyled
            backgroundColor: '#e9ecef', 
            color: '#6c757d',
        } : {}}
      >
        {skillName}
      </span>
    );
  }
  
  return (
    <span className={tagClassName} style={inlineTagStyle}>
      {visuals.logo && (
        <img
          src={`${process.env.PUBLIC_URL}${visuals.logo}`}
          alt={`${skillName} logo`}
          className="skill-logo-img" // Defined in SkillTagWithLogo.css
          onError={(e) => { 
            e.target.style.display = 'none';
            // console.warn(`Logo not found for skill: ${skillName} at path: ${visuals.logo}`);
          }}
        />
      )}
      <span className="skill-name-text">{skillName}</span> {/* Wrap skillName for potential styling */}
      {children} {/* This is where the '×' button will go */}
    </span>
  );
};

export default SkillTagWithLogo;
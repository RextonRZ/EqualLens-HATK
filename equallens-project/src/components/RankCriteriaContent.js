import React from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import './RankCriteriaModal.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const RankCriteriaContent = ({ prompt = "" }) => {
    // Define colors by category
    const colorScheme = {
        skills: '#8250c8', // Purple for Skills
        experience: '#dd20c1', // Pink for Experience
        education: '#0066cc', // Blue for Education
        culturalFit: '#ffa000' // Orange for Cultural Fit
    };

    // Define subcriteria details with weights
    const subcriteriaDetails = {
        skills: {
            relevance: 50,
            proficiency: 35,
            additionalSkill: 15
        },
        experience: {
            jobExp: 50,
            projectCocurricularExp: 30,
            certification: 20
        },
        education: {
            studyLevel: 40,
            awards: 30,
            courseworkResearch: 30
        },
        culturalFit: {
            collaborationStyle: 40,
            growthMindset: 30,
            communityEngagement: 30
        }
    };

    // Format names for display
    const formatNames = {
        skills: 'Skills',
        experience: 'Experience',
        education: 'Education',
        culturalFit: 'Cultural Fit',
        relevance: 'Relevance',
        proficiency: 'Proficiency',
        additionalSkill: 'Additional Skills',
        jobExp: 'Job Experience',
        projectCocurricularExp: 'Project & Co-curricular',
        certification: 'Certification',
        studyLevel: 'Study Level',
        awards: 'Awards',
        courseworkResearch: 'Coursework & Research',
        collaborationStyle: 'Collaboration Style',
        growthMindset: 'Growth Mindset',
        communityEngagement: 'Community Engagement'
    };

    // Determine which criteria are mentioned in the prompt
    const promptLower = (prompt || "").toLowerCase();
    const criteriaPresent = {
        'skills': promptLower.includes('skills'),
        'experience': promptLower.includes('experience'),
        'education': promptLower.includes('education'),
        'culturalFit': promptLower.includes('cultural fit')
    };

    // If no criteria explicitly mentioned, assume all are present
    if (!Object.values(criteriaPresent).some(present => present)) {
        Object.keys(criteriaPresent).forEach(key => criteriaPresent[key] = true);
    }

    // Count active criteria
    const activeCriteriaCount = Object.values(criteriaPresent).filter(Boolean).length;

    // Prepare data for pie chart with subcriteria
    const labels = [];
    const values = [];
    const backgroundColor = [];
    const borderColor = [];

    // Calculate weight for each main criterion (equal distribution)
    const mainCriteriaWeight = 100 / activeCriteriaCount;

    // Process each criterion if present
    Object.entries(criteriaPresent).forEach(([category, isPresent]) => {
        if (!isPresent) return;

        const categoryColor = colorScheme[category];
        // Calculate subcriteria weights
        Object.entries(subcriteriaDetails[category]).forEach(([subcriterion, weight]) => {
            // Add this subcriterion to the chart data
            labels.push(formatNames[subcriterion]);

            // Calculate the actual percentage (main criterion weight * subcriterion weight within its category)
            const actualPercentage = (mainCriteriaWeight * (weight / 100));
            values.push(actualPercentage);

            // Generate slightly different shades for subcriteria within the same category
            const baseColor = categoryColor;
            const alpha = 0.7 + (0.3 * Math.random()); // Vary opacity slightly for visual distinction

            backgroundColor.push(`${baseColor}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`);
            borderColor.push(baseColor);
        });
    });

    // Prepare table data for display
    const tableData = [];
    Object.entries(criteriaPresent).forEach(([category, isPresent]) => {
        if (!isPresent) return;

        Object.entries(subcriteriaDetails[category]).forEach(([subName, subWeight]) => {
            // Calculate the final weight percentage
            const finalWeight = ((mainCriteriaWeight * subWeight) / 100).toFixed(1);

            tableData.push({
                category: formatNames[category],
                subcriterion: formatNames[subName],
                categoryWeight: mainCriteriaWeight.toFixed(1),
                subWeight: subWeight,
                finalWeight: finalWeight,
            });
        });
    });

    // Set up data for the pie chart
    const data = {
        labels: labels,
        datasets: [
            {
                data: values,
                backgroundColor: backgroundColor,
                borderColor: borderColor,
                borderWidth: 1
            }
        ]
    };

    // Chart options
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false, // Hide the built-in legend
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        return `${context.label}: ${context.raw.toFixed(1)}%`;
                    }
                }
            },
            // Add this to disable number labels on chart segments
            datalabels: {
                display: false // Completely hide the data labels on the chart
            }
        }
    };

    return (
        <div className="ranking-criteria-content">
            <div className="criteria-weights-section">
                <h3>Criteria Distribution</h3>

                <div className="visualization-container">
                    <div className="fixed-chart-container">
                        <Pie data={data} options={options} />
                    </div>

                    <div className="custom-legend-container">
                        {labels.map((label, index) => (
                            <div
                                key={index}
                                className="legend-item"
                                style={{
                                    animation: `slideIn 0.5s ease-out forwards`,
                                    animationDelay: `${index * 0.1}s`,
                                    opacity: 0,
                                    transform: 'translateX(-20px)'
                                }}
                            >
                                <span
                                    className="legend-color-box"
                                    style={{ backgroundColor: backgroundColor[index] }}
                                ></span>
                                <span className="legend-text">
                                    {label} ({values[index].toFixed(1)}%)
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="criteria-table-section">
                    <h4>How Candidates Are Scored</h4>
                    <div className="criteria-table-container">
                        <table className="criteria-table">
                            <thead>
                                <tr>
                                    <th className="category-column">Category</th>
                                    <th className="subcriteria-column">Subcriteria</th>
                                    <th className="weight-column">Category Weight</th>
                                    <th className="weight-column">Subcriteria Weight</th>
                                    <th className="weight-column">Final Weight</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(criteriaPresent)
                                    .filter(([_, isPresent]) => isPresent)
                                    .map(([category, _]) => {
                                        const categoryColor = colorScheme[category];
                                        const categoryName = formatNames[category];
                                        const subcriteria = Object.entries(subcriteriaDetails[category]);

                                        return subcriteria.map(([subName, subWeight], subIndex) => (
                                            <tr key={`${category}-${subName}`}>
                                                {subIndex === 0 ? (
                                                    <td
                                                        className="category-cell"
                                                        rowSpan={subcriteria.length}
                                                        style={{
                                                            backgroundColor: `${categoryColor}22`,
                                                            borderLeft: `4px solid ${categoryColor}`
                                                        }}
                                                    >
                                                        <span style={{ color: categoryColor, fontWeight: 600 }}>
                                                            {categoryName}
                                                        </span>
                                                    </td>
                                                ) : null}
                                                <td>{formatNames[subName]}</td>
                                                {subIndex === 0 ? (
                                                    <td rowSpan={subcriteria.length} className="center-align">
                                                        {mainCriteriaWeight.toFixed(1)}%
                                                    </td>
                                                ) : null}
                                                <td className="center-align">{subWeight}%</td>
                                                <td className="center-align">
                                                    {((mainCriteriaWeight * subWeight) / 100).toFixed(1)}%
                                                </td>
                                            </tr>
                                        ));
                                    })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RankCriteriaContent;
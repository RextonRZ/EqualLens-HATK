import React, { useState, useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import {
    ArcElement,
    PolarAreaController,
    RadialLinearScale,
    LineElement,
    BarElement
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import annotationPlugin from 'chartjs-plugin-annotation';
import './DetailedScoringModal.css';

// Register required Chart.js components and plugins
Chart.register(
    ArcElement,
    PolarAreaController,
    RadialLinearScale,
    LineElement,
    BarElement,
    annotationPlugin,
    ChartDataLabels
);

const DetailedScoringModal = ({ applicant, onClose }) => {
    const [chartData, setChartData] = useState(null);
    const [activeTab, setActiveTab] = useState("summary"); // Add tab state
    const pieChartRef = useRef(null);
    const barChartRef = useRef(null);

    const CRITERIA_WEIGHTS = {
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

    const calculateWeightedScores = () => {
        if (!applicant || !applicant.rank_score) {
            return {
                skills: {},
                experience: {},
                education: {},
                culturalFit: {},
                categoryTotals: {},
                finalScore: 0
            };
        }

        const scores = {
            skills: {},
            experience: {},
            education: {},
            culturalFit: {},
            categoryTotals: {},
            finalScore: 0
        };

        let totalWeight = 0;
        let weightedSum = 0;

        if (applicant.rank_score.relevance) {
            scores.skills.relevance = applicant.rank_score.relevance * CRITERIA_WEIGHTS.skills.relevance;
            scores.skills.proficiency = applicant.rank_score.proficiency * CRITERIA_WEIGHTS.skills.proficiency;
            scores.skills.additionalSkill = applicant.rank_score.additionalSkill * CRITERIA_WEIGHTS.skills.additionalSkill;

            scores.categoryTotals.skills = scores.skills.relevance + scores.skills.proficiency + scores.skills.additionalSkill;
            weightedSum += scores.categoryTotals.skills;
            totalWeight += 1;
        }

        if (applicant.rank_score.jobExp) {
            scores.experience.jobExp = applicant.rank_score.jobExp * CRITERIA_WEIGHTS.experience.jobExp;
            scores.experience.projectCocurricularExp = applicant.rank_score.projectCocurricularExp * CRITERIA_WEIGHTS.experience.projectCocurricularExp;
            scores.experience.certification = applicant.rank_score.certification * CRITERIA_WEIGHTS.experience.certification;

            scores.categoryTotals.experience = scores.experience.jobExp + scores.experience.projectCocurricularExp + scores.experience.certification;
            weightedSum += scores.categoryTotals.experience;
            totalWeight += 1;
        }

        if (applicant.rank_score.studyLevel) {
            scores.education.studyLevel = applicant.rank_score.studyLevel * CRITERIA_WEIGHTS.education.studyLevel;
            scores.education.awards = applicant.rank_score.awards * CRITERIA_WEIGHTS.education.awards;
            scores.education.courseworkResearch = applicant.rank_score.courseworkResearch * CRITERIA_WEIGHTS.education.courseworkResearch;

            scores.categoryTotals.education = scores.education.studyLevel + scores.education.awards + scores.education.courseworkResearch;
            weightedSum += scores.categoryTotals.education;
            totalWeight += 1;
        }

        if (applicant.rank_score.collaborationStyle || applicant.rank_score.growthMindset || applicant.rank_score.communityEngagement) {
            scores.culturalFit.collaborationStyle = (applicant.rank_score.collaborationStyle || 0) * CRITERIA_WEIGHTS.culturalFit.collaborationStyle;
            scores.culturalFit.growthMindset = (applicant.rank_score.growthMindset || 0) * CRITERIA_WEIGHTS.culturalFit.growthMindset;
            scores.culturalFit.communityEngagement = (applicant.rank_score.communityEngagement || 0) * CRITERIA_WEIGHTS.culturalFit.communityEngagement;

            scores.categoryTotals.culturalFit = scores.culturalFit.collaborationStyle + scores.culturalFit.growthMindset + scores.culturalFit.communityEngagement;
            weightedSum += scores.categoryTotals.culturalFit;
            totalWeight += 1;
        }

        scores.finalScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

        return scores;
    };

    const weightedScores = calculateWeightedScores();

    const formatPercentage = (num) => {
        return (Number(num) * 10).toFixed(1) + '%';
    };

    const formatNumber = (num) => {
        return Number(num).toFixed(2);
    };

    useEffect(() => {
        if (!applicant || !applicant.rank_score) {
            return;
        }

        let polarChartInstance = null;
        let barChartInstance = null;

        const timer = setTimeout(() => {
            if (pieChartRef.current && barChartRef.current) {
                // Determine which categories have data
                const hasSkills = 'relevance' in applicant.rank_score ||
                    'proficiency' in applicant.rank_score ||
                    'additionalSkill' in applicant.rank_score;

                const hasExperience = 'jobExp' in applicant.rank_score ||
                    'projectCocurricularExp' in applicant.rank_score ||
                    'certification' in applicant.rank_score;

                const hasEducation = 'studyLevel' in applicant.rank_score ||
                    'awards' in applicant.rank_score ||
                    'courseworkResearch' in applicant.rank_score;

                const hasCulturalFit = 'collaborationStyle' in applicant.rank_score ||
                    'growthMindset' in applicant.rank_score ||
                    'communityEngagement' in applicant.rank_score;

                // Create filtered labels and datasets based on available categories
                const activeLabels = [];
                const activeData = [];
                const activeBackgroundColors = [];
                const activeBorderColors = [];
                const activeHoverBackgroundColors = [];

                if (hasSkills) {
                    activeLabels.push('Skills');
                    activeData.push((weightedScores.categoryTotals.skills || 0) * 10);
                    activeBackgroundColors.push('rgba(130, 80, 200, 0.7)');
                    activeBorderColors.push('rgba(130, 80, 200, 1)');
                    activeHoverBackgroundColors.push('rgba(130, 80, 200, 0.9)');
                }

                if (hasExperience) {
                    activeLabels.push('Experience');
                    activeData.push((weightedScores.categoryTotals.experience || 0) * 10);
                    activeBackgroundColors.push('rgba(221, 32, 193, 0.7)');
                    activeBorderColors.push('rgba(221, 32, 193, 1)');
                    activeHoverBackgroundColors.push('rgba(221, 32, 193, 0.9)');
                }

                if (hasEducation) {
                    activeLabels.push('Education');
                    activeData.push((weightedScores.categoryTotals.education || 0) * 10);
                    activeBackgroundColors.push('rgba(0, 102, 204, 0.7)');
                    activeBorderColors.push('rgba(0, 102, 204, 1)');
                    activeHoverBackgroundColors.push('rgba(0, 102, 204, 0.9)');
                }

                if (hasCulturalFit) {
                    activeLabels.push('Cultural Fit');
                    activeData.push((weightedScores.categoryTotals.culturalFit || 0) * 10);
                    activeBackgroundColors.push('rgba(255, 165, 0, 0.7)');
                    activeBorderColors.push('rgba(255, 165, 0, 1)');
                    activeHoverBackgroundColors.push('rgba(255, 165, 0, 0.9)');
                }

                // If no categories have data, use all categories but with zeros
                if (activeLabels.length === 0) {
                    activeLabels.push('Skills', 'Experience', 'Education', 'Cultural Fit');
                    activeData.push(0, 0, 0);
                    activeBackgroundColors.push(
                        'rgba(130, 80, 200, 0.7)',
                        'rgba(221, 32, 193, 0.7)',
                        'rgba(0, 102, 204, 0.7)',
                        'rgba(255, 165, 0, 0.7)'
                    );
                    activeBorderColors.push(
                        'rgba(130, 80, 200, 1)',
                        'rgba(221, 32, 193, 1)',
                        'rgba(0, 102, 204, 1)',
                        'rgba(255, 165, 0, 1)'
                    );
                    activeHoverBackgroundColors.push(
                        'rgba(130, 80, 200, 0.9)',
                        'rgba(221, 32, 193, 0.9)',
                        'rgba(0, 102, 204, 0.9)',
                        'rgba(255, 165, 0, 0.9)'
                    );
                }

                // Create average data array with the same number of points as active labels
                const meanScore = (weightedScores.finalScore || 0) * 10;

                const polarCtx = pieChartRef.current.getContext('2d');
                polarChartInstance = new Chart(polarCtx, {
                    type: 'polarArea',
                    data: {
                        labels: activeLabels,
                        datasets: [
                            {
                                data: activeData,
                                backgroundColor: activeBackgroundColors,
                                borderColor: activeBorderColors,
                                borderWidth: 1,
                                hoverBackgroundColor: activeHoverBackgroundColors,
                                hoverBorderWidth: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            r: {
                                beginAtZero: true,
                                max: 100,
                                ticks: {
                                    display: true,
                                    backdropColor: 'transparent',
                                    color: '#666',
                                    font: {
                                        size: 10
                                    },
                                    stepSize: 20,
                                    callback: function (value) {
                                        return value + '%';
                                    }
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.1)'
                                },
                                pointLabels: {
                                    color: '#333',
                                    font: {
                                        family: "'PT Sans', sans-serif",
                                        size: 16,
                                        weight: 'bold'
                                    }
                                },
                                angleLines: {
                                    color: 'rgba(0, 0, 0, 0.1)',
                                    display: true
                                },
                            }
                        },
                        plugins: {
                            title: {
                                display: false
                            },
                            subtitle: {
                                display: false
                            },
                            legend: {
                                position: 'bottom',
                                align: 'center',
                                labels: {
                                    color: '#333',
                                    font: {
                                        family: "'PT Sans', sans-serif",
                                        size: 14,
                                        weight: 'bold'
                                    },
                                    usePointStyle: true,
                                    boxWidth: 10,
                                    padding: 20,
                                    generateLabels: function (chart) {
                                        const labels = [];

                                        if (hasSkills) {
                                            labels.push({
                                                text: 'Skills',
                                                fillStyle: 'rgba(130, 80, 200, 0.7)',
                                                strokeStyle: 'rgba(130, 80, 200, 1)',
                                                lineWidth: 1,
                                                hidden: false
                                            });
                                        }

                                        if (hasExperience) {
                                            labels.push({
                                                text: 'Experience',
                                                fillStyle: 'rgba(221, 32, 193, 0.7)',
                                                strokeStyle: 'rgba(221, 32, 193, 1)',
                                                lineWidth: 1,
                                                hidden: false
                                            });
                                        }

                                        if (hasEducation) {
                                            labels.push({
                                                text: 'Education',
                                                fillStyle: 'rgba(0, 102, 204, 0.7)',
                                                strokeStyle: 'rgba(0, 102, 204, 1)',
                                                lineWidth: 1,
                                                hidden: false
                                            });
                                        }

                                        if (hasCulturalFit) {
                                            labels.push({
                                                text: 'Cultural Fit',
                                                fillStyle: 'rgba(255, 165, 0, 0.7)',
                                                strokeStyle: 'rgba(255, 165, 0, 1)',
                                                lineWidth: 1,
                                                hidden: false
                                            });
                                        }

                                        labels.push({
                                            text: 'Overall Average',
                                            fillStyle: 'rgba(0, 0, 0, 0)',
                                            strokeStyle: '#F9645F',
                                            lineWidth: 2,
                                            lineDash: [5, 5],
                                            hidden: false
                                        });

                                        return labels;
                                    }
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                titleColor: '#333',
                                bodyColor: '#333',
                                borderColor: '#ccc',
                                borderWidth: 1,
                                titleFont: {
                                    family: "'PT Sans', sans-serif",
                                    size: 16,
                                    weight: 'bold'
                                },
                                bodyFont: {
                                    family: "'PT Sans', sans-serif",
                                    size: 14
                                },
                                callbacks: {
                                    title: function (context) {
                                        return context[0].label + ' Category';
                                    },
                                    label: function (context) {
                                        return `Score: ${context.raw.toFixed(1)}%`;
                                    },
                                    filter: function (tooltipItem) {
                                        return tooltipItem.datasetIndex === 0;
                                    }
                                }
                            },
                            datalabels: {
                                display: false
                            }
                        },
                        animation: {
                            duration: 1500,
                            easing: 'easeOutQuart'
                        }
                    }
                });

                // Add a second chart for the average triangle overlay
                if (pieChartRef.current) {
                    // Wait for chart to be fully rendered before adding overlay
                    setTimeout(() => {
                        // Remove any existing overlays
                        const existingOverlay = pieChartRef.current.parentNode.querySelector('.triangle-overlay');
                        if (existingOverlay) {
                            existingOverlay.remove();
                        }

                        // Get chart dimensions from Chart.js instance
                        const chartArea = polarChartInstance.chartArea;
                        const centerX = (chartArea.left + chartArea.right) / 2;
                        const centerY = (chartArea.top + chartArea.bottom) / 2;

                        // Calculate the radius based on chart scale
                        const scale = polarChartInstance.scales.r;
                        const radius = scale.getDistanceFromCenterForValue(meanScore);

                        // Create overlay canvas with proper position and size
                        const overlayCanvas = document.createElement('canvas');
                        overlayCanvas.className = 'triangle-overlay';
                        overlayCanvas.style.position = 'absolute';
                        overlayCanvas.style.top = '0';
                        overlayCanvas.style.left = '0';
                        // Set to very low z-index to ensure it's below tooltips and chart elements
                        overlayCanvas.style.zIndex = '-1';
                        overlayCanvas.style.pointerEvents = 'none';
                        overlayCanvas.width = pieChartRef.current.width;
                        overlayCanvas.height = pieChartRef.current.height;
                        pieChartRef.current.parentNode.appendChild(overlayCanvas);

                        const overlayCtx = overlayCanvas.getContext('2d');

                        // Draw an upright triangle (two points on bottom, one on top)
                        overlayCtx.beginPath();
                        // Top point
                        overlayCtx.moveTo(centerX, centerY - radius);
                        // Bottom right point
                        overlayCtx.lineTo(centerX + radius * Math.cos(Math.PI / 6), centerY + radius * Math.sin(Math.PI / 6));
                        // Bottom left point
                        overlayCtx.lineTo(centerX - radius * Math.cos(Math.PI / 6), centerY + radius * Math.sin(Math.PI / 6));
                        overlayCtx.closePath();

                        overlayCtx.strokeStyle = '#F9645F';
                        overlayCtx.lineWidth = 2;
                        overlayCtx.setLineDash([5, 5]);
                        overlayCtx.stroke();

                        // Ensure tooltips have high z-index
                        const styleElement = document.createElement('style');
                        styleElement.textContent = `
                            #${pieChartRef.current.id}-tooltip-element {
                                z-index: 1000 !important;
                            }
                            .chartjs-tooltip {
                                z-index: 1000 !important;
                            }
                        `;
                        document.head.appendChild(styleElement);

                        const originalCleanup = polarChartInstance.destroy;
                        polarChartInstance.destroy = function () {
                            originalCleanup.apply(this, arguments);
                            if (overlayCanvas && overlayCanvas.parentNode) {
                                overlayCanvas.parentNode.removeChild(overlayCanvas);
                            }
                            if (styleElement && styleElement.parentNode) {
                                styleElement.parentNode.removeChild(styleElement);
                            }
                        };
                    }, 300); // Wait for chart animation to complete
                }

                const barCtx = barChartRef.current.getContext('2d');
                barChartInstance = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: activeLabels,
                        datasets: [{
                            label: 'Category Score',
                            data: activeData,
                            backgroundColor: activeBackgroundColors,
                            borderColor: activeBorderColors,
                            borderWidth: 2,
                            borderRadius: 6,
                            hoverBackgroundColor: activeHoverBackgroundColors,
                            hoverBorderWidth: 3,
                            maxBarThickness: activeLabels.length <= 1 ? 100 : activeLabels.length === 2 ? 90 : 80
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: {
                            padding: {
                                top: 25,
                                right: 20,
                                bottom: 10,
                                left: 10
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                max: 100,
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                },
                                ticks: {
                                    color: '#666',
                                    font: {
                                        family: "'PT Sans', sans-serif",
                                        size: 12
                                    },
                                    callback: function (value) {
                                        return value + '%';
                                    }
                                },
                                title: {
                                    display: true,
                                    text: 'Score (%)',
                                    color: '#666',
                                    font: {
                                        family: "'PT Sans', sans-serif",
                                        size: 14,
                                        weight: 'bold'
                                    }
                                }
                            },
                            x: {
                                grid: {
                                    display: false
                                },
                                ticks: {
                                    color: '#333',
                                    font: {
                                        family: "'PT Sans', sans-serif",
                                        size: 14,
                                        weight: 'bold'
                                    }
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                titleColor: '#333',
                                bodyColor: '#333',
                                bodyFont: {
                                    family: "'PT Sans', sans-serif",
                                    size: 14
                                },
                                titleFont: {
                                    family: "'PT Sans', sans-serif",
                                    size: 16,
                                    weight: 'bold'
                                },
                                borderColor: '#ccc',
                                borderWidth: 1,
                                padding: 10,
                                callbacks: {
                                    title: function (context) {
                                        return context[0].label + ' Category';
                                    },
                                    label: function (context) {
                                        return `Score: ${context.raw.toFixed(1)}%`;
                                    }
                                }
                            },
                            datalabels: {
                                display: false
                            },
                            annotation: {
                                annotations: {
                                    meanLine: {
                                        type: 'line',
                                        yMin: meanScore,
                                        yMax: meanScore,
                                        borderColor: '#F9645F',
                                        borderWidth: 3,
                                        borderDash: [6, 4],
                                        label: {
                                            display: true,
                                            content: `Overall Average: ${meanScore.toFixed(1)}%`,
                                            position: activeLabels.length <= 2 ? 'end' : 'start',
                                            backgroundColor: '#F9645F',
                                            color: 'white',
                                            font: {
                                                family: "'PT Sans', sans-serif",
                                                size: 13,
                                                weight: 'bold'
                                            },
                                            padding: {
                                                top: 6,
                                                bottom: 6,
                                                left: 10,
                                                right: 10
                                            },
                                            borderRadius: 6,
                                            xAdjust: activeLabels.length <= 1 ? -30 : 0,
                                            yAdjust: 20,
                                            z: 100
                                        }
                                    }
                                }
                            }
                        },
                        animation: {
                            duration: 1000,
                            easing: 'easeOutQuart'
                        }
                    }
                });
            }
        }, 100);

        return () => {
            clearTimeout(timer);
            if (polarChartInstance) polarChartInstance.destroy();
            if (barChartInstance) barChartInstance.destroy();
        };
    }, [weightedScores, applicant]);

    const renderBreakdownContent = () => {
        // Determine which categories are present in the scoring
        const hasSkills = 'relevance' in applicant.rank_score;
        const hasExperience = 'jobExp' in applicant.rank_score;
        const hasEducation = 'studyLevel' in applicant.rank_score;
        const hasCulturalFit = 'collaborationStyle' in applicant.rank_score;

        // Count how many categories are being used
        const activeCategoryCount = [hasSkills, hasExperience, hasEducation, hasCulturalFit].filter(Boolean).length;

        // Create data for category scores display with proper percentages
        const categoryData = [
            {
                name: 'Skills',
                isActive: hasSkills,
                rawScores: {
                    relevance: applicant.rank_score.relevance || 0,
                    proficiency: applicant.rank_score.proficiency || 0,
                    additionalSkill: applicant.rank_score.additionalSkill || 0
                },
                weights: CRITERIA_WEIGHTS.skills,
                weightedTotal: (weightedScores.categoryTotals.skills || 0),
                percentage: ((weightedScores.categoryTotals.skills || 0) * 10).toFixed(1) + '%',
                color: '#8250c8'
            },
            {
                name: 'Experience',
                isActive: hasExperience,
                rawScores: {
                    jobExp: applicant.rank_score.jobExp || 0,
                    projectCocurricularExp: applicant.rank_score.projectCocurricularExp || 0,
                    certification: applicant.rank_score.certification || 0
                },
                weights: CRITERIA_WEIGHTS.experience,
                weightedTotal: (weightedScores.categoryTotals.experience || 0),
                percentage: ((weightedScores.categoryTotals.experience || 0) * 10).toFixed(1) + '%',
                color: '#dd20c1'
            },
            {
                name: 'Education',
                isActive: hasEducation,
                rawScores: {
                    studyLevel: applicant.rank_score.studyLevel || 0,
                    awards: applicant.rank_score.awards || 0,
                    courseworkResearch: applicant.rank_score.courseworkResearch || 0
                },
                weights: CRITERIA_WEIGHTS.education,
                weightedTotal: (weightedScores.categoryTotals.education || 0),
                percentage: ((weightedScores.categoryTotals.education || 0) * 10).toFixed(1) + '%',
                color: '#0066cc'
            },
            {
                name: 'Cultural Fit',
                isActive: hasCulturalFit,
                rawScores: {
                    collaborationStyle: applicant.rank_score.collaborationStyle || 0,
                    growthMindset: applicant.rank_score.growthMindset || 0,
                    communityEngagement: applicant.rank_score.communityEngagement || 0
                },
                weights: CRITERIA_WEIGHTS.culturalFit,
                weightedTotal: (weightedScores.categoryTotals.culturalFit || 0),
                percentage: ((weightedScores.categoryTotals.culturalFit || 0) * 10).toFixed(1) + '%',
                color: '#ffa500'
            }
        ];

        // Names mapping for better display - shorter names for long criteria
        const criteriaNames = {
            relevance: "Relevance to Job",
            proficiency: "Proficiency Level",
            additionalSkill: "Additional Skills",
            jobExp: "Job Experience",
            projectCocurricularExp: "Projects & Co-curr.", // Shortened this
            certification: "Certifications",
            studyLevel: "Level of Study",
            awards: "Awards & Achievements",
            courseworkResearch: "Relevant Coursework",
            collaborationStyle: "Collaboration Style",
            growthMindset: "Growth Mindset",
            communityEngagement: "Community Engagement"
        };

        // Full names for tooltips
        const fullCriteriaNames = {
            projectCocurricularExp: "Projects & Co-curricular Experience",
            courseworkResearch: "Relevant Coursework & Research"
        };

        // Create a function to render the appropriate score interpretation based on active categories
        const renderScoreInterpretation = () => {
            // Create a key to determine which template to use
            const categoryKey = `${hasSkills ? 'S' : ''}${hasExperience ? 'E' : ''}${hasEducation ? 'D' : ''}${hasCulturalFit ? 'C' : ''}`;

            // Common card styling
            const cardStyle = {
                flex: "1",
                minWidth: "200px",
                backgroundColor: "white",
                borderRadius: "8px",
                padding: "1rem",
                boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                border: "1px solid #e5e7eb"
            };

            // Common header styling
            const getHeaderStyle = (color) => ({
                margin: "0 0 0.5rem 0",
                color: color,
                fontSize: "1.1rem",
                fontWeight: "600"
            });

            // Common paragraph styling
            const paragraphStyle = {
                margin: 0,
                fontSize: "0.9rem",
                color: "#6b7280"
            };

            switch (categoryKey) {
                case 'S': // Skills only
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skill match with outstanding job-relevant abilities
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong skill profile with very good relevance and proficiency
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good skill set with adequate proficiency for the role requirements
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Skills may not fully match job requirements, additional training recommended
                                </p>
                            </div>
                        </>
                    );

                case 'E': // Experience only
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional experience profile with highly relevant background
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong experience level with valuable job expertise and certifications
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good work experience that satisfies basic job requirements
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Experience may not align well with position requirements
                                </p>
                            </div>
                        </>
                    );

                case 'D': // Education only
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional educational background with outstanding academic achievements
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong academic qualifications with relevant coursework and awards
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good educational foundation that meets position requirements
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Educational background may need supplementation for this role
                                </p>
                            </div>
                        </>
                    );
                
                case 'C': // Cultural Fit only
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional cultural fit with strong alignment to company values
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong cultural alignment with very good collaboration style
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good cultural fit with adequate growth mindset and community engagement
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Cultural fit may not align well with company values, further assessment needed
                                </p>
                            </div>
                        </>
                    );

                case 'SE': // Skills + Experience
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skills and experience with outstanding practical expertise
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong professional competencies backed by relevant work history
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good practical abilities with adequate professional background
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Skills and experience may need enhancement to meet job demands
                                </p>
                            </div>
                        </>
                    );

                case 'SD': // Skills + Education
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skills with outstanding academic preparation
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong abilities supported by relevant educational background
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good theoretical and practical knowledge for the position
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May need practical experience to complement theoretical knowledge
                                </p>
                            </div>
                        </>
                    );
                
                case 'SC': // Skills + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skills with strong alignment to company culture
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong skill set with very good cultural fit and collaboration style
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good skills with adequate cultural alignment and growth mindset
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Skills may not fully align with company culture, further assessment needed
                                </p>
                            </div>
                        </>
                    );

                case 'ED': // Experience + Education
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional credentials with outstanding work and academic background
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong professional history with highly relevant education
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good combination of practical experience and formal education
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May need skill-specific training despite background qualifications
                                </p>
                            </div>
                        </>
                    );
                
                case 'EC' : // Experience + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional experience with strong cultural alignment to the organization
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong professional background with very good cultural fit
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good work experience with adequate cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Experience may not fully match company culture, further assessment needed
                                </p>
                            </div>
                        </>
                    );
                
                case 'DC': // Education + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional educational background with strong cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong academic qualifications with very good cultural fit
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good educational foundation with adequate cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    Educational background may not fully align with company culture, further assessment needed
                                </p>
                            </div>
                        </>
                    );

                case 'SED': // Skills + Experience + Education
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional match for the position with outstanding qualifications
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong candidate with very good match to job requirements
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good potential with adequate qualifications for the role
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May not fully match the job requirements, further review recommended
                                </p>
                            </div>
                        </>
                    );
                
                case 'SEC': // Skills + Experience + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skills and experience with strong cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong professional competencies with very good cultural fit
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good combination of skills, experience, and cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May need further assessment to ensure skills and culture fit
                                </p>
                            </div>
                        </>
                    );
                
                case 'EDC': // Experience + Education + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional credentials with outstanding work, academic, and cultural background
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong candidate with very good professional, educational, and cultural fit
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good combination of experience, education, and cultural alignment
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May not fully match the job requirements, further review recommended
                                </p>
                            </div>
                        </>
                    );
                
                case 'SDC': // Skills + Education + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional skills and academic background with strong cultural alignment.
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong abilities, relevant education, and very good cultural fit.
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good theoretical knowledge, practical skills, and adequate cultural alignment.
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May require further assessment for skill, education, or cultural fit.
                                </p>
                            </div>
                        </>
                    );
                
                case 'SEDC': // Skills + Experience + Education + Cultural Fit
                    return (
                        <>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#059669")}>80-100: Excellent</h6>
                                <p style={paragraphStyle}>
                                    Exceptional match for the position with outstanding qualifications across all areas
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#0284c7")}>65-79: Strong</h6>
                                <p style={paragraphStyle}>
                                    Strong candidate with very good match to job requirements in all categories
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#eab308")}>50-64: Good</h6>
                                <p style={paragraphStyle}>
                                    Good potential with adequate qualifications across skills, experience, education, and cultural fit
                                </p>
                            </div>
                            <div className="interpretation-card" style={cardStyle}>
                                <h6 style={getHeaderStyle("#ef4444")}>Below 50: Needs Review</h6>
                                <p style={paragraphStyle}>
                                    May not fully match the job requirements, further review recommended
                                </p>
                            </div>
                        </>
                    );

                default: // No categories selected
                    return (
                        <div style={{
                            padding: "1rem",
                            textAlign: "center",
                            color: "#6b7280",
                            backgroundColor: "#f9fafb",
                            borderRadius: "8px"
                        }}>
                            <p>No scoring categories selected to interpret</p>
                        </div>
                    );
            }
        };

        return (
            <div className="detailed-calculations">
                <h3>How The Score is Calculated</h3>

                {/* Display a message when no categories are selected */}
                {activeCategoryCount === 0 && (
                    <div className="no-criteria-message" style={{
                        padding: "1.5rem",
                        backgroundColor: "#fffbeb",
                        border: "1px solid #fef3c7",
                        borderRadius: "8px",
                        color: "#92400e",
                        textAlign: "center",
                        marginBottom: "1.5rem"
                    }}>
                        <p style={{ margin: 0, fontWeight: "500" }}>No scoring criteria were selected for this applicant.</p>
                    </div>
                )}

                {/* Step 1: Explain how each criterion is weighted */}
                <div className="calculation-section">
                    <h4>Step 1: Individual Criteria Scores (0-10)</h4>
                    <p className="step-explanation">
                        Each criterion is scored from 0-10 based on how well the candidate's qualifications match the job requirements.
                    </p>

                    {/* Show active categories */}
                    {categoryData.filter(cat => cat.isActive).map((category, catIndex) => (
                        <div key={catIndex} className="category-section" style={{ marginBottom: "1.5rem" }}>
                            <div className="category-header" style={{
                                display: "flex",
                                alignItems: "center",
                                marginBottom: "0.75rem"
                            }}>
                                <div className="category-color-indicator" style={{
                                    width: "12px",
                                    height: "12px",
                                    borderRadius: "50%",
                                    backgroundColor: category.color,
                                    marginRight: "8px"
                                }}></div>
                                <h5 style={{
                                    margin: 0,
                                    color: category.color,
                                    fontWeight: "600",
                                    fontSize: "1.15rem" // Increased font size here
                                }}>{category.name}</h5>
                            </div>

                            <div className="criteria-scores-grid" style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                                gap: "1rem"
                            }}>
                                {Object.entries(category.rawScores).map(([key, value], i) => (
                                    <div key={i} className="criteria-score-card" style={{
                                        padding: "0.75rem",
                                        backgroundColor: "white",
                                        borderRadius: "8px",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                                        border: "1px solid #e5e7eb"
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                                            <div style={{
                                                display: "flex",
                                                alignItems: "center",
                                                maxWidth: "75%"
                                            }}>
                                                <span style={{
                                                    fontWeight: "500",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis"
                                                }}
                                                    title={fullCriteriaNames[key] || criteriaNames[key]}>
                                                    {criteriaNames[key]}
                                                </span>
                                                <span className="weight-badge" style={{
                                                    marginLeft: "8px",
                                                    backgroundColor: `${category.color}20`,
                                                    color: category.color,
                                                    borderRadius: "4px",
                                                    padding: "2px 6px",
                                                    fontSize: "0.8rem",
                                                    fontWeight: "600",
                                                    whiteSpace: "nowrap"
                                                }}>
                                                    {(category.weights[key] * 100)}%
                                                </span>
                                            </div>
                                            <span style={{ fontWeight: "600" }}>{value}/10</span>
                                        </div>
                                        <div style={{
                                            height: "8px",
                                            backgroundColor: "#f3f4f6",
                                            borderRadius: "4px",
                                            position: "relative",
                                            overflow: "hidden"
                                        }}>
                                            <div style={{
                                                height: "100%",
                                                width: `${value * 10}%`,
                                                backgroundColor: category.color,
                                                borderRadius: "4px",
                                                transition: "width 1s ease-out"
                                            }}></div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}

                    {activeCategoryCount === 0 && (
                        <div style={{
                            padding: "1rem",
                            backgroundColor: "#f9fafb",
                            borderRadius: "8px",
                            textAlign: "center",
                            color: "#6b7280"
                        }}>
                            No criteria scores available
                        </div>
                    )}
                </div>

                {/* Step 2: Show how weighted category scores are calculated */}
                <div className="calculation-section">
                    <h4>Step 2: Weighted Category Scores</h4>
                    <p className="step-explanation">
                        Within each category, criteria are weighted differently based on importance.
                        The weighted scores are combined to get a category score.
                    </p>

                    <div className="category-weights-container" style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                        marginTop: "1rem"
                    }}>
                        {categoryData.filter(cat => cat.isActive).map((category, catIndex) => {
                            // Create a colorized formula with different colors for different weights
                            const formulaEntries = Object.entries(category.rawScores);
                            const getColorShade = (weight) => {
                                // Return different color shades based on weight value
                                if (weight === 0.5 || weight === 0.4) return '90'; // Darkest for highest weight
                                if (weight === 0.35 || weight === 0.3) return '70'; // Medium for middle weight
                                return '50'; // Lightest for lowest weight
                            };

                            return (
                                <div key={catIndex} className="category-weight-card" style={{
                                    backgroundColor: "white",
                                    borderRadius: "10px",
                                    padding: "1.25rem",
                                    boxShadow: "0 4px 6px rgba(0,0,0,0.05)",
                                    border: `1px solid ${category.color}30`
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                                        <h5 style={{
                                            margin: 0,
                                            color: category.color,
                                            fontWeight: "600",
                                            fontSize: "1.15rem"
                                        }}>{category.name} Category</h5>
                                        <span style={{ fontWeight: "bold" }}>{category.percentage}</span>
                                    </div>

                                    <div className="weight-formula" style={{
                                        backgroundColor: "#f9fafb",
                                        padding: "1rem",
                                        borderRadius: "8px",
                                        fontFamily: "monospace",
                                        marginBottom: "1rem",
                                        fontSize: "0.95rem",
                                        textAlign: "center",
                                        display: "flex",
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "0.25rem"
                                    }}>
                                        {formulaEntries.map(([key, value], i, arr) => {
                                            const weight = category.weights[key];
                                            const weightPercentage = weight * 100;
                                            const colorShade = getColorShade(weight);

                                            return (
                                                <React.Fragment key={i}>
                                                    <span style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        padding: "2px 4px",
                                                        borderRadius: "4px",
                                                    }}>
                                                        <span>{value}</span>
                                                        <span style={{ margin: "0 3px" }}>×</span>
                                                        <span style={{
                                                            backgroundColor: `${category.color}${colorShade}`,
                                                            color: "white",
                                                            borderRadius: "4px",
                                                            padding: "2px 6px",
                                                            fontWeight: "bold"
                                                        }}>
                                                            {weightPercentage}%
                                                        </span>
                                                    </span>
                                                    {i < arr.length - 1 && <span style={{ margin: "0 4px" }}> + </span>}
                                                </React.Fragment>
                                            );
                                        })}
                                        <span style={{ margin: "0 4px" }}> = </span>
                                        <strong>{category.weightedTotal.toFixed(2)}</strong>
                                    </div>

                                    {/* Enhanced segmented progress bar */}
                                    <div style={{ marginBottom: "1rem" }}>
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginBottom: "0.25rem",
                                            fontSize: "0.75rem",
                                            color: "#6b7280"
                                        }}>
                                            <span>0</span>
                                            <span>2</span>
                                            <span>4</span>
                                            <span>6</span>
                                            <span>8</span>
                                            <span>10</span>
                                        </div>

                                        {/* Container for the segmented bar */}
                                        <div style={{
                                            height: "24px",
                                            backgroundColor: "#f3f4f6",
                                            borderRadius: "6px",
                                            position: "relative",
                                            overflow: "hidden",
                                            border: "1px solid #e5e7eb"
                                        }}>
                                            {/* Calculate segments for each criterion's contribution */}
                                            {(() => {
                                                let startPosition = 0;
                                                return Object.entries(category.rawScores).map(([key, value], i) => {
                                                    const weight = category.weights[key];
                                                    // Calculate how much this criterion contributes to the total score
                                                    const contribution = value * weight;
                                                    // Convert to percentage of max possible score (10)
                                                    const widthPercent = contribution * 10;
                                                    const colorShade = getColorShade(weight);

                                                    // Save current position before updating for next segment
                                                    const currentStart = startPosition;
                                                    startPosition += widthPercent;

                                                    return (
                                                        <div
                                                            key={i}
                                                            style={{
                                                                position: "absolute",
                                                                left: `${currentStart}%`,
                                                                top: 0,
                                                                height: "100%",
                                                                width: `${widthPercent}%`,
                                                                backgroundColor: `${category.color}${colorShade}`,
                                                                transition: "width 1s ease-out, left 1s ease-out",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "center",
                                                                color: "white",
                                                                fontWeight: "bold",
                                                                fontSize: "0.75rem",
                                                                overflow: "hidden",
                                                                whiteSpace: "nowrap"
                                                            }}
                                                            title={`${criteriaNames[key]}: ${contribution.toFixed(2)} points (${value} × ${(weight * 100)}%)`}
                                                        >
                                                            {contribution >= 0.5 ? contribution.toFixed(1) : ""}
                                                        </div>
                                                    );
                                                });
                                            })()}

                                            {/* Total score marker */}
                                            <div style={{
                                                position: "absolute",
                                                right: `${100 - (category.weightedTotal * 10)}%`,
                                                top: 0,
                                                height: "100%",
                                                width: "2px",
                                                backgroundColor: "#000",
                                                zIndex: 2
                                            }}></div>

                                            {/* Score indicator label */}
                                            <div style={{
                                                position: "absolute",
                                                right: `${100 - (category.weightedTotal * 10)}%`,
                                                top: "-20px",
                                                transform: "translateX(50%)",
                                                backgroundColor: "#000",
                                                color: "white",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                fontSize: "0.7rem",
                                                fontWeight: "bold"
                                            }}>
                                                {category.weightedTotal.toFixed(2)}
                                            </div>
                                        </div>

                                        {/* Scale labels */}
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginTop: "0.5rem"
                                        }}>
                                            <div style={{
                                                width: "100%",
                                                height: "4px",
                                                backgroundImage: "linear-gradient(to right, #f3f4f6 49%, transparent 49%, transparent 51%, #f3f4f6 51%)",
                                                backgroundSize: "20% 1px",
                                                backgroundRepeat: "repeat-x",
                                                marginBottom: "4px"
                                            }}></div>
                                        </div>
                                    </div>

                                    {/* Add a criteria weight breakdown visualization */}
                                    <div className="criteria-weight-breakdown" style={{
                                        marginTop: "0.5rem",
                                        padding: "0.75rem",
                                        backgroundColor: "#f9fafb",
                                        borderRadius: "8px"
                                    }}>
                                        <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "#6b7280" }}>Criteria Contribution:</p>

                                        {/* Criteria contribution breakdown */}
                                        {Object.entries(category.rawScores).map(([key, value], i) => {
                                            const weight = category.weights[key];
                                            const contribution = value * weight;
                                            const colorShade = getColorShade(weight);

                                            return (
                                                <div key={i} style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    marginBottom: "0.5rem",
                                                    fontSize: "0.85rem"
                                                }}>
                                                    <div style={{ display: "flex", alignItems: "center", flex: 3 }}>
                                                        <span style={{
                                                            width: "10px",
                                                            height: "10px",
                                                            backgroundColor: `${category.color}${colorShade}`,
                                                            borderRadius: "2px",
                                                            marginRight: "8px"
                                                        }}></span>
                                                        <span title={fullCriteriaNames[key] || criteriaNames[key]}>
                                                            {criteriaNames[key]}
                                                        </span>
                                                    </div>
                                                    <div style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        flex: 2,
                                                        justifyContent: "flex-end",
                                                        fontFamily: "monospace",
                                                        color: "#4b5563"
                                                    }}>
                                                        <span>{value}</span>
                                                        <span style={{ margin: "0 4px" }}>×</span>
                                                        <span style={{
                                                            color: category.color,
                                                            fontWeight: "600"
                                                        }}>{(weight * 100)}%</span>
                                                        <span style={{ margin: "0 4px" }}>=</span>
                                                        <span style={{
                                                            fontWeight: "bold",
                                                            color: "#111827"
                                                        }}>{contribution.toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div style={{
                                            height: "1px",
                                            backgroundColor: "#e5e7eb",
                                            margin: "0.5rem 0"
                                        }}></div>

                                        <div style={{
                                            display: "flex",
                                            justifyContent: "flex-end",
                                            alignItems: "center",
                                            fontFamily: "monospace",
                                            fontSize: "0.85rem",
                                            fontWeight: "bold"
                                        }}>
                                            <span style={{ marginRight: "8px" }}>Total:</span>
                                            <span style={{
                                                color: category.color,
                                                fontSize: "1rem"
                                            }}>{category.weightedTotal.toFixed(2)}/10</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {activeCategoryCount === 0 && (
                            <div style={{
                                padding: "1rem",
                                backgroundColor: "#f9fafb",
                                borderRadius: "8px",
                                textAlign: "center",
                                color: "#6b7280"
                            }}>
                                No weighted scores available
                            </div>
                        )}
                    </div>
                </div>

                {/* Step 3: Final Score Calculation */}
                <div className="calculation-section">
                    <h4>Step 3: Final Score Calculation</h4>
                    <p className="step-explanation">
                        The final score is the average of the category scores, scaled to 100.
                        {activeCategoryCount > 0 && ` Since ${activeCategoryCount} ${activeCategoryCount === 1 ? 'category is' : 'categories are'} used, each contributes equally to the final score.`}
                    </p>

                    <div className="final-score-visualization" style={{
                        backgroundColor: "white",
                        borderRadius: "12px",
                        padding: "1.5rem",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                        marginTop: "1rem",
                        position: "relative",
                        overflow: "hidden"
                    }}>
                        {activeCategoryCount > 0 ? (
                            <>
                                {/* Visual formula */}
                                <div className="visual-formula" style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexWrap: "wrap",
                                    gap: "0.75rem",
                                    marginBottom: "1.5rem",
                                    padding: "1rem",
                                    backgroundColor: "#f9fafb",
                                    borderRadius: "10px"
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                                        <span style={{ fontSize: "1.2rem" }}>( </span>

                                        {categoryData.filter(cat => cat.isActive).map((category, i, arr) => (
                                            <React.Fragment key={i}>
                                                <div style={{
                                                    padding: "0.5rem 1rem",
                                                    backgroundColor: category.color,
                                                    color: "white",
                                                    borderRadius: "6px",
                                                    fontWeight: "600",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "0.5rem",
                                                    margin: "0.25rem 0"
                                                }}>
                                                    <span>{category.name}</span>
                                                    <span>{category.percentage}</span>
                                                </div>
                                                {i < arr.length - 1 && <span style={{ margin: "0 0.5rem" }}>+</span>}
                                            </React.Fragment>
                                        ))}

                                        <span style={{ fontSize: "1.2rem" }}> ) ÷ {activeCategoryCount} =</span>
                                    </div>

                                    <div style={{
                                        padding: "0.5rem 1.5rem",
                                        backgroundColor: "#4f46e5",
                                        color: "white",
                                        borderRadius: "8px",
                                        fontWeight: "700",
                                        fontSize: "1.3rem"
                                    }}>
                                        {((weightedScores.finalScore || 0) * 10).toFixed(1)}%
                                    </div>
                                </div>

                                {/* Progress bar visualization */}
                                <div className="progress-visualization" style={{ marginBottom: "1rem" }}>
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginBottom: "0.5rem",
                                        fontSize: "0.9rem",
                                        color: "#6b7280"
                                    }}>
                                        <span>0%</span>
                                        <span>50%</span>
                                        <span>100%</span>
                                    </div>
                                    <div style={{
                                        height: "20px",
                                        backgroundColor: "#f3f4f6",
                                        borderRadius: "10px",
                                        position: "relative",
                                        overflow: "hidden"
                                    }}>
                                        <div style={{
                                            height: "100%",
                                            width: `${(weightedScores.finalScore || 0) * 10}%`,
                                            background: "linear-gradient(90deg, #4f46e5, #F9645F)",
                                            borderRadius: "10px",
                                            transition: "width 1.5s ease-out",
                                            animation: "pulse 2s infinite"
                                        }}></div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div style={{
                                padding: "1.5rem",
                                textAlign: "center",
                                color: "#6b7280"
                            }}>
                                <p style={{ margin: 0 }}>No categories selected, unable to calculate final score</p>
                            </div>
                        )}

                        {/* Decorative elements */}
                        <div style={{
                            position: "absolute",
                            bottom: "-30px",
                            right: "-30px",
                            width: "120px",
                            height: "120px",
                            borderRadius: "50%",
                            background: "radial-gradient(circle, rgba(79, 70, 229, 0.1) 0%, transparent 70%)",
                            zIndex: "0"
                        }}></div>
                        <div style={{
                            position: "absolute",
                            top: "-20px",
                            left: "-20px",
                            width: "80px",
                            height: "80px",
                            borderRadius: "50%",
                            background: "radial-gradient(circle, rgba(249, 100, 95, 0.1) 0%, transparent 70%)",
                            zIndex: "0"
                        }}></div>
                    </div>
                </div>

                {/* Score Interpretation */}
                <div className="calculation-section">
                    <h4>Score Interpretation</h4>
                    <div className="score-interpretation" style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "1rem",
                        marginTop: "1rem"
                    }}>
                        {renderScoreInterpretation()}
                    </div>
                </div>
            </div>
        );
    };

    if (!applicant || !applicant.rank_score) {
        return null;
    }

    return (
        <div className="detailed-scoring-modal-overlay">
            <div className="detailed-scoring-modal">
                <div className="modal-header">
                    <h2>Detailed Score Calculation</h2>
                    <button className="close-modal-button" onClick={onClose}>×</button>
                </div>
                {/* Overall score display stays at the top in both tabs */}
                <div className="overall-score-display">
                    <h3>Overall Score: {formatPercentage(weightedScores.finalScore)}</h3>
                    <p className="score-explanation">
                        The overall score is calculated as the average of the category scores, each weighted by their respective importance.
                    </p>
                </div>

                {/* Add tabs navigation */}
                <div className="modal-tabs">
                    <button
                        className={`tab-button ${activeTab === "summary" ? "active" : ""}`}
                        onClick={() => setActiveTab("summary")}
                    >
                        Score Summary
                    </button>
                    <button
                        className={`tab-button ${activeTab === "breakdown" ? "active" : ""}`}
                        onClick={() => setActiveTab("breakdown")}
                    >
                        Calculation Breakdown
                    </button>
                </div>

                {/* Conditionally render content based on active tab */}
                {activeTab === "summary" && (
                    <div className="score-charts">
                        <div className="chart-container polar-chart-container">
                            <h4>Category Comparison</h4>
                            <div className="chart-wrapper">
                                <canvas ref={pieChartRef} height="250"></canvas>
                            </div>
                        </div>

                        <div className="chart-container bar-chart-container">
                            <h4>Score Distribution</h4>
                            <div className="chart-wrapper">
                                <canvas ref={barChartRef} height="250"></canvas>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "breakdown" && renderBreakdownContent()}
            </div>
        </div>
    );
};

export default DetailedScoringModal;

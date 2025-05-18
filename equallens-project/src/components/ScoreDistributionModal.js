import React from 'react';
import './ScoringStandardModal.css'; // Reuse the same CSS
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell, PieChart, Pie, Label, Sector } from 'recharts';

const ScoreDistributionModal = ({ isOpen, onClose, applicant, job }) => {
    // Move the useState hook to the top level before any conditional returns
    const [activeIndex, setActiveIndex] = React.useState(null);
    
    if (!isOpen) return null;

    // Define weights for each criterion based on category
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
        }
    };

    // Category colors for better visualization
    const categoryColors = {
        "skills": "#8250c8",
        "experience": "#dd20c1", 
        "education": "#0066cc"
    };

    // Get candidate scores
    const scores = applicant?.rank_score || {};
    
    // Define criteria mappings for display purposes
    const criteriaMap = {
        'relevance': { name: 'Relevance', category: 'skills' },
        'proficiency': { name: 'Proficiency', category: 'skills' },
        'additionalSkill': { name: 'Add. Skills', category: 'skills' },
        'jobExp': { name: 'Job Experience', category: 'experience' },
        'projectCocurricularExp': { name: 'Projects', category: 'experience' },
        'certification': { name: 'Certifications', category: 'experience' },
        'studyLevel': { name: 'Study Level', category: 'education' },
        'awards': { name: 'Awards', category: 'education' },
        'courseworkResearch': { name: 'Coursework', category: 'education' }
    };

    // Define the order of categories and criteria within each category
    const categoryOrder = ['skills', 'experience', 'education'];
    const criteriaOrder = {
        'skills': ['relevance', 'proficiency', 'additionalSkill'],
        'experience': ['jobExp', 'projectCocurricularExp', 'certification'],
        'education': ['studyLevel', 'awards', 'courseworkResearch']
    };

    // Prepare data for the bar chart - sort by category rather than score
    const rawScoreData = [];
    
    // First process data by category order
    categoryOrder.forEach(category => {
        // Then process data by criteria order within each category
        criteriaOrder[category].forEach(criteriaKey => {
            if (scores[criteriaKey] !== undefined) {
                const weight = CRITERIA_WEIGHTS[category]?.[criteriaKey] || 0;
                const value = scores[criteriaKey];
                const weightedScore = value * weight;
                
                rawScoreData.push({
                    name: criteriaMap[criteriaKey]?.name || criteriaKey,
                    score: value,
                    category: category,
                    weight: weight,
                    weightedScore: weightedScore
                });
            }
        });
    });

    // Calculate total raw score
    const totalRawScore = applicant?.rank_score?.final_score || 0;

    // Create data for the pie chart - calculate percentage contribution of each criterion
    const calculateContributions = () => {
        // Calculate category-wise weighted scores first
        const categoryScores = {};
        let totalWeightedScore = 0;
        
        rawScoreData.forEach(item => {
            // Add to category total
            if (!categoryScores[item.category]) {
                categoryScores[item.category] = 0;
            }
            categoryScores[item.category] += item.weightedScore;
            totalWeightedScore += item.weightedScore;
        });
        
        // Calculate contribution for each criterion
        return rawScoreData.map(item => {
            const percentValue = totalWeightedScore > 0 ? Math.round((item.weightedScore / totalWeightedScore) * 100) : 0;
            return {
                name: item.name,
                value: percentValue,
                rawScore: item.score,
                weightedScore: item.weightedScore.toFixed(2),
                category: item.category
            };
        });
    };

    const contributionData = calculateContributions();

    // Calculate final weights for each criterion (matching the values in the picture)
    const calculateFinalWeights = () => {
        // Count how many categories are being used
        const usedCategories = categoryOrder.filter(category => 
            criteriaOrder[category].some(key => scores[key] !== undefined)
        ).length;
        
        // If no categories are used, return empty object
        if (usedCategories === 0) return {};
        
        // Category weight is equally distributed
        const categoryWeight = 1 / usedCategories;
        
        // Calculate final weight for each criterion
        const finalWeights = {};
        
        categoryOrder.forEach(category => {
            const criteriaInCategory = criteriaOrder[category].filter(key => scores[key] !== undefined);
            
            // If this category has no criteria with scores, skip it
            if (criteriaInCategory.length === 0) return;
            
            criteriaInCategory.forEach(criteriaKey => {
                // Final weight = Category Weight × Criteria Weight within Category
                const criteriaWeightInCategory = CRITERIA_WEIGHTS[category][criteriaKey];
                finalWeights[criteriaKey] = categoryWeight * criteriaWeightInCategory * 100;
            });
        });
        
        return finalWeights;
    };

    const finalWeights = calculateFinalWeights();

    // Handlers for pie chart hover effects
    const onPieEnter = (_, index) => {
        setActiveIndex(index);
    };

    const onPieLeave = () => {
        setActiveIndex(null);
    };

    // Custom render for active pie sector - remove text elements that get blocked by the center score
    const renderActiveShape = (props) => {
        const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
        
        return (
            <g>
                <Sector
                    cx={cx}
                    cy={cy}
                    innerRadius={innerRadius}
                    outerRadius={outerRadius + 5}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                    opacity={0.8}
                />
                <Sector
                    cx={cx}
                    cy={cy}
                    innerRadius={innerRadius - 3}
                    outerRadius={innerRadius - 1}
                    startAngle={startAngle}
                    endAngle={endAngle}
                    fill={fill}
                />
            </g>
        );
    };

    // Create data for the progress ring chart that shows contribution of each criterion
    const preparePieChartData = () => {
        // First create segments for each criterion's weighted contribution
        let pieData = rawScoreData.map(item => ({
            name: item.name,
            value: parseFloat(item.weightedScore) * 10, // Scale to percentage of total (100)
            category: item.category,
            rawScore: item.score
        }));
        
        // Add remaining segment to reach 100%
        const totalValue = pieData.reduce((sum, item) => sum + item.value, 0);
        const remaining = Math.max(0, 100 - totalValue);
        
        if (remaining > 0) {
            pieData.push({
                name: 'Remaining',
                value: remaining,
                category: 'remaining',
                isRemaining: true
            });
        }
        
        return pieData;
    };

    const pieChartData = preparePieChartData();

    return (
        <div className="scoring-standard-modal-overlay">
            <div className="scoring-standard-modal-content">
                <button className="close-modal-button" onClick={onClose}>×</button>
                <div className="scoring-standard-header">
                    <h2>Raw Score Distribution</h2>
                    <div className="final-score-display">
                        Final Score: <span className="final-score-value">{totalRawScore.toFixed(2)}</span>/100
                    </div>
                </div>

                <div className="scoring-standard-body">
                    {/* Layout for side-by-side charts */}
                    <div className="charts-flex-container">
                        <div className="bar-chart-container">
                            <h3>Individual Criteria Scores</h3>
                            <ResponsiveContainer width="100%" height={400}>
                                <BarChart 
                                    data={rawScoreData} 
                                    margin={{ top: 20, right: 30, left: 20, bottom: 120 }} // Increased bottom margin
                                >
                                    <XAxis 
                                        dataKey="name" 
                                        angle={-45} 
                                        textAnchor="end" 
                                        height={100}  // Increased height for labels
                                        interval={0}  // Ensure all labels are shown
                                        tick={{ fontSize: 12 }}
                                    />
                                    <YAxis 
                                        domain={[0, 10]} 
                                        label={{ value: 'Score', angle: -90, position: 'insideLeft' }} 
                                    />
                                    <Tooltip 
                                        formatter={(value, name, props) => {
                                            if (name === 'score') return [value + '/10', 'Raw Score'];
                                            if (name === 'weightedScore') return [value.toFixed(2), 'Weighted Score'];
                                            return [value, name];
                                        }}
                                    />
                                    <Legend 
                                        wrapperStyle={{ paddingTop: 20 }} 
                                        payload={[
                                            { value: 'Skills', type: 'square', color: categoryColors.skills },
                                            { value: 'Experience', type: 'square', color: categoryColors.experience },
                                            { value: 'Education', type: 'square', color: categoryColors.education }
                                        ]}
                                    />
                                    <Bar 
                                        dataKey="score" 
                                        radius={[4, 4, 0, 0]}
                                    >
                                        {rawScoreData.map((entry, index) => (
                                            <Cell 
                                                key={`cell-${index}`} 
                                                fill={categoryColors[entry.category]} 
                                                fillOpacity={(entry) => {
                                                    if (entry.category === 'skills') return 1;
                                                    if (entry.category === 'experience') return 0.85;
                                                    if (entry.category === 'education') return 0.7;
                                                    return 0.9;
                                                }}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="pie-chart-container">
                            <h3>Contribution to Final Score</h3>
                            <ResponsiveContainer width="100%" height={400}>
                                <PieChart>
                                    {/* Create progress ring chart with criteria segments */}
                                    <Pie
                                        activeIndex={activeIndex}
                                        activeShape={renderActiveShape}
                                        data={pieChartData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={90}
                                        startAngle={90}
                                        endAngle={-270}
                                        dataKey="value"
                                        onMouseEnter={onPieEnter}
                                        onMouseLeave={onPieLeave}
                                    >
                                        {pieChartData.map((entry, index) => (
                                            <Cell 
                                                key={`cell-${index}`} 
                                                fill={entry.isRemaining ? "#E0E0E0" : categoryColors[entry.category]}
                                                opacity={entry.isRemaining ? 0.3 : 0.9}
                                            />
                                        ))}
                                    </Pie>

                                    {/* Add the final score in the center of the pie chart */}
                                    <text 
                                        x="50%" 
                                        y="50%" 
                                        textAnchor="middle" 
                                        dominantBaseline="middle"
                                        style={{
                                            fontSize: '22px',
                                            fontWeight: 'bold',
                                            fill: '#F9645F'
                                        }}
                                    >
                                        {totalRawScore.toFixed(1)}
                                    </text>
                                    <text 
                                        x="50%" 
                                        y="50%" 
                                        dy="20" 
                                        textAnchor="middle" 
                                        dominantBaseline="middle"
                                        style={{
                                            fontSize: '12px',
                                            fill: '#666'
                                        }}
                                    >
                                         /100
                                    </text>
                                    <Tooltip 
                                        formatter={(value, name, props) => {
                                            if (name === 'Remaining') {
                                                return [`${value.toFixed(1)}%`, 'Remaining'];
                                            }
                                            const entry = props.payload;
                                            return [
                                                `${value.toFixed(1)}% (Score: ${entry.rawScore}/10)`, 
                                                entry.name
                                            ];
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Added spacing after charts */}
                    <div style={{ marginTop: '40px' }}></div>

                    <div className="calculation-details">
                        <h3>Raw Score Breakdown</h3>
                        <div className="calculation-table-container">
                            <table className="calculation-table">
                                <thead>
                                    <tr>
                                        <th>Category</th>
                                        <th>Criteria</th>
                                        <th>Raw Score</th>
                                        <th>Weight</th>
                                        <th>Weighted Score</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(criteriaMap)
                                        .filter(([key]) => scores[key] !== undefined)
                                        .sort(([keyA], [keyB]) => {
                                            const catA = criteriaMap[keyA].category;
                                            const catB = criteriaMap[keyB].category;
                                            return catA.localeCompare(catB);
                                        })
                                        .reduce((acc, [key, info], index, array) => {
                                            const currentCategory = info.category;
                                            const prevCategory = index > 0 ? criteriaMap[array[index - 1][0]].category : null;
                                            
                                            // Group by category and track category changes
                                            const isCategoryStart = currentCategory !== prevCategory;
                                            
                                            const score = scores[key];
                                            const weight = CRITERIA_WEIGHTS[info.category]?.[key] || 0;
                                            const weightedScore = score * weight;
                                            const finalWeight = finalWeights[key] || 0;
                                            
                                            acc.push({
                                                key,
                                                name: info.name,
                                                category: info.category,
                                                score,
                                                weight,
                                                finalWeight, // Add the final weight
                                                weightedScore,
                                                isCategoryStart
                                            });
                                            
                                            return acc;
                                        }, [])
                                        .map((item, index, groupedItems) => {
                                            // Count items in this category for rowspan
                                            const categoryCount = groupedItems.filter(i => i.category === item.category).length;
                                            
                                            return (
                                                <tr key={item.key} className={item.isCategoryStart ? 'category-start' : ''}>
                                                    {item.isCategoryStart ? (
                                                        <td 
                                                            rowSpan={categoryCount}
                                                            className="category-cell"
                                                            style={{backgroundColor: `${categoryColors[item.category]}20`}}
                                                        >
                                                            {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
                                                        </td>
                                                    ) : null}
                                                    <td>{item.name}</td>
                                                    <td>{item.score}/10</td>
                                                    <td>{item.finalWeight.toFixed(1)}%</td>
                                                    <td>{item.weightedScore.toFixed(2)}</td>
                                                </tr>
                                            );
                                        })
                                    }
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan="4" className="final-score-label">Final Raw Score (0-100)</td>
                                        <td className="final-score-cell">{totalRawScore.toFixed(2)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div className="calculation-formula">
                            <h4>How Raw Score is Calculated:</h4>
                            <ol>
                                <li>Each criterion is scored from 0-10 based on the candidate's resume</li>
                                <li>Criterion scores are weighted within their category (Skills, Experience, Education)</li>
                                <li>Each category's weighted average is calculated</li>
                                <li>The final raw score is the weighted average of all category scores, scaled to 100</li>
                                <li>Only categories selected in the ranking criteria are included in the calculation</li>
                            </ol>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ScoreDistributionModal;

export const skillVisuals = {
  // Frontend & JS
  'javascript': { logo: '/logos/javascript.svg' },
  'react': { logo: '/logos/react.svg' },
  'angular': { logo: '/logos/angular.svg' },
  'vue.js': { logo: '/logos/vuejs.svg' },
  'typescript': { logo: '/logos/typescript.svg' },
  'html': { logo: '/logos/html.svg' },
  'html5': { logo: '/logos/html5.svg' },
  'css': { logo: '/logos/css.svg' },
  'css3': { logo: '/logos/css3.svg' },
  'node.js': { logo: '/logos/nodejs.svg' },

  // Backend & Languages
  'python': { logo: '/logos/python.svg' },
  'java': { logo: '/logos/java.svg' },
  'C#': { logo: '/logos/csharp.svg' },
  'c#': { logo: '/logos/csharp.svg' },
  'php': { logo: '/logos/php.svg' },
  'ruby': { logo: '/logos/ruby.svg' },
  '.net core': { logo: '/logos/dotnet.svg' },
  'dotnet': { logo: '/logos/dotnet.svg' },
  'r': { logo: '/logos/r.svg' },
  'powershell': { logo: '/logos/powershell.svg' },
  'PowerShell': { logo: '/logos/powershell.svg' },

  // Databases
  'sql': { logo: '/logos/sql.svg' },
  'mongodb': { logo: '/logos/mongodb.svg' },
  'oracle': { logo: '/logos/oracle.svg' },
  'mysql': { logo: '/logos/mysql.svg' },
  'postgresql': { logo: '/logos/postgresql.svg' },

  // Cloud & DevOps
  'aws': { logo: '/logos/aws.svg' },
  'amazon web services': { logo: '/logos/aws.svg' },
  'azure': { logo: '/logos/azure.svg' },
  'git': { logo: '/logos/git.svg' },
  'terraform': { logo: '/logos/terraform.svg' }, 
  'confluence': { logo: '/logos/confluence.svg' },
  'jira': { logo: '/logos/jira.svg' },

  // AI/ML
  'tensorflow': { logo: '/logos/tensorflow.svg' },
  'pytorch': { logo: '/logos/pytorch.svg' },
  'scikit-learn': { logo: '/logos/scikit-learn.svg' }, 
  'gans': { logo: '/logos/gan.svg' }, 
  'gan': { logo: '/logos/gan.svg' }, 
  'computer vision': { logo: '/logos/cv.svg' }, 
  'cv': { logo: '/logos/cv.svg' }, 
  'data analysis': { logo: '/logos/dataanalysis.svg' },
  'fastapi': { logo: '/logos/fastAPI.svg' },

  // Design & Media
  'adobe creative suite': { logo: '/logos/adobe_creative_suite.svg' },
  'canva': { logo: '/logos/canva.svg' },
  'figma': { logo: '/logos/figma.svg' },
  'wordpress': { logo: '/logos/wordpress.svg' },

  // Other tools
  'chatgpt': { logo: '/logos/chatgpt.svg' },
  'linux': { logo: '/logos/linux.svg' },
  'microsoft office': { logo: '/logos/microsoftoffice.svg' },
  'ms office': { logo: '/logos/microsoftoffice.svg' },
  'excel': { logo: '/logos/excel.svg' },
  'microsoft project': { logo: '/logos/microsoftproject.svg' },
  'infinityqs': { logo: '/logos/infinityqs.svg' },
  'minitab': { logo: '/logos/minitab.svg' },
  'power bi': { logo: '/logos/power_bi.svg' },
  'axure': { logo: '/logos/axure.svg' },
  'xero': { logo: '/logos/xero.svg' },
  'cisco': { logo: '/logos/cisco.svg' },
  'dev ops': { logo: '/logos/devops.svg' },
  'docker': { logo: '/logos/docker.svg' },
  'go': { logo: '/logos/go.svg' },
  'kubernetes': { logo: '/logos/kubernetes.svg' },
  'sass': { logo: '/logos/sass.svg' },
  'tableau': { logo: '/logos/tableau.svg' },

  // Skills without logos but optionally styled
  'communication': { logo: null },
  'creativity': { logo: null },
  'problem solving': { logo: null },
  'writing skills': { logo: null },
  'science': { logo: null },
  'life contingencies': { logo: null },
  'financial mathematics': { logo: null },
  'actuarial math 1': { logo: null },
  'brand development': { logo: null },
  'machine learning': { logo: '/logos/machinelearning.svg' },
  'object-oriented programming': { logo: '/logos/oop.svg' },
  'object oriented programming': { logo: '/logos/oop.svg' },
  'oop': { logo: '/logos/oop.svg' },

  'rest api': { logo: '/logos/restapi.svg' },
  'proficiency in bahasa melayu': { logo: null },
  'proficiency in english': { logo: null },
  'project management': { logo: null },
  'social media management': { logo: null },
  'strong analytical skills': { logo: null },
  'windows': { logo: '/logos/windows.svg' },


  // Default
  default: { logo: null, color: '#e9ecef', textColor: '#495057' }
};

export const getSkillVisuals = (skillName) => {
  if (!skillName) return skillVisuals.default;
  const standardizedName = String(skillName).toLowerCase().trim();
  const specificVisual = skillVisuals[standardizedName];

  if (specificVisual && specificVisual.logo) {
    return specificVisual;
  }

  return skillVisuals.default;
};
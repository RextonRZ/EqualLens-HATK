import React,{useState, useEffect} from 'react'
import { Link } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { Button } from './Button';
import './Navbar.css';

function Navbar() {
    const [click, setClick] = useState(false);
    const [button, setButton] = useState(true);
  
    const handleClick = () => setClick(!click);
    const closeMobileMenu = () => setClick(false);

    // Add scroll to top functionality
    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        closeMobileMenu();
    };
  
    const showButton = () => {
      if (window.innerWidth <= 960) {
        setButton(false);
      } else {
        setButton(true);
      }
    };
  
    useEffect(() => {
      showButton();
    }, []);
  
    window.addEventListener('resize', showButton);
  
    return (
      <>
        <nav className='navbar'>
          <div className='navbar-container'>
            <Link to='/' className='navbar-logo' onClick={scrollToTop}>
              <div className="logo-container">
                <img 
                  src="/equalLensLogoWhite.png" 
                  alt="EqualLens Logo Light" 
                  className="navbar-logo-image" 
                />
              </div>
            </Link>
            <div className='menu-icon' onClick={handleClick}>
              <i className={click ? 'fas fa-times' : 'fas fa-bars'} />
            </div>
            <ul className={click ? 'nav-menu active' : 'nav-menu'}>
              <li className='nav-item'>
                <Link to='/' className='nav-links' onClick={scrollToTop}>
                  <i className="fas fa-home icon-spacing"></i> Home
                </Link>
              </li>
              <li className='nav-item'>
                <Link to='/upload-cv' className='nav-links' onClick={scrollToTop}>
                  <i className="fas fa-upload icon-spacing"></i> New job
                </Link>
              </li>
              <li className='nav-item'>
                <Link to='/dashboard' className='nav-links' onClick={scrollToTop}>
                  <i className="fas fa-chart-line icon-spacing"></i> Dashboard
                </Link>
              </li>
              <li>
                <Link
                  to='/sign-up'
                  className='nav-links-mobile'
                  onClick={scrollToTop}
                >
                  <i className="fas fa-user-plus icon-spacing"></i> Sign Up
                </Link>
              </li>
            </ul>
            {/* {button && <Button className="btn" buttonStyle='btn--primary'>SIGN UP</Button>} */}
          </div>
        </nav>
      </>
    );
  }
  
  export default Navbar;

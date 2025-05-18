import React from 'react';
import './Footer.css';
import { Button } from './Button';
import { Link } from 'react-router-dom';

function Footer() {
  // Organize footer links for better mobile layout
  const footerLinks = [
    {
      title: "About Us",
      links: [
        { text: "Our Mission", to: "/" },
        { text: "Our Team", to: "/" },
        { text: "Terms of Service", to: "/" },
      ]
    },
    {
      title: "Contact Us",
      links: [
        { text: "Support", to: "/" },
        { text: "Partnerships", to: "/" },
        { text: "Career", to: "/" },
      ]
    },
    {
      title: "Resources",
      links: [
        { text: "Blog", to: "/" },
        { text: "Case Studies", to: "/" },
        { text: "Documentation", to: "/" },
        { text: "FAQ", to: "/" },
      ]
    },
    {
      title: "Connect",
      links: [
        { text: "LinkedIn", to: "/" },
        { text: "Twitter", to: "/" },
        { text: "Instagram", to: "/" },
        { text: "Facebook", to: "/" },
      ]
    }
  ];

  return (
    <div className='footer-container'>
      <div className='footer-links'>
        {/* First row of links */}
        <div className='footer-link-wrapper'>
          {footerLinks.map((section, index) => (
            <div className='footer-link-items' key={index}>
              <h2>{section.title}</h2>
              {section.links.map((link, linkIndex) => (
                <Link to={link.to} key={linkIndex}>{link.text}</Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <section className='social-media'>
        <div className='social-media-wrap'>
          <div className='footer-logo'>
            <Link to='/'>
              <img 
                src="/equalLensLogoDark.png" 
                alt="EqualLens Logo Dark" 
                className="footer-logo-image"
              />
            </Link>
          </div>
          <small className='website-rights'>EQUALLENS © 2025</small>
          <div className='social-icons'>
            <Link
              className='social-icon-link'
              to='/'
              target='_blank'
              aria-label='Facebook'
            >
              <i className='fab fa-facebook-f' />
            </Link>
            <Link
              className='social-icon-link'
              to='/'
              target='_blank'
              aria-label='Instagram'
            >
              <i className='fab fa-instagram' />
            </Link>
            <Link
              className='social-icon-link'
              to='/'
              target='_blank'
              aria-label='Youtube'
            >
              <i className='fab fa-youtube' />
            </Link>
            <Link
              className='social-icon-link'
              to='/'
              target='_blank'
              aria-label='Twitter'
            >
              <i className='fab fa-twitter' />
            </Link>
            <Link
              className='social-icon-link'
              to='/'
              target='_blank'
              aria-label='LinkedIn'
            >
              <i className='fab fa-linkedin' />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Footer;
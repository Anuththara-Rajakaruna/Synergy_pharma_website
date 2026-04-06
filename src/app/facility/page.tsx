"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const facilities = [
  {
    id: 1,
    title: "Manufacturing Facilities",
    description: "State-of-the-art production lines meeting WHO-GMP standards with precision automation and quality control systems.",
    image: "/facilities/manufacturing.jpg",
  },
  {
    id: 2,
    title: "General OSD Unit",
    description: "High-capacity oral solid dosage manufacturing with tablet and capsule capabilities for global markets.",
    image: "/facilities/osd.jpg",
  },
  {
    id: 3,
    title: "Injectable Facility",
    description: "Sterile fill-finish operations for small volume parenteral (SVP) and large volume parenteral (LVP) products.",
    image: "/facilities/injectable.jpg",
  },
  {
    id: 4,
    title: "Oncology Facility",
    description: "Specialized unit for oncology OSD and injectable formulations with enhanced containment protocols.",
    image: "/facilities/oncology.jpg",
  },
  {
    id: 5,
    title: "Hormone Facility",
    description: "Dedicated manufacturing for hormone-based OSD, injectables, and topical ointment formulations.",
    image: "/facilities/hormone.jpg",
  },
  {
    id: 6,
    title: "R&D Center",
    description: "Advanced research laboratories for formulation development, stability studies, and process optimization.",
    image: "/facilities/research.jpg",
  },
  {
    id: 7,
    title: "Quality Control Lab",
    description: "Advanced analytical testing center with state-of-the-art instruments for product quality verification, stability testing, and regulatory compliance.",
    image: "/facilities/manufacturing.jpg",
  },
];

const fadeInUpVariants = {
  initial: { opacity: 0, y: 50 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.6 },
  viewport: { once: true, amount: 0.3 },
};

const staggerContainerVariants = {
  initial: { opacity: 0 },
  whileInView: { opacity: 1 },
  viewport: { once: true, amount: 0.3 },
};

const staggerChildVariants = {
  initial: { opacity: 0, y: 50 },
  whileInView: { opacity: 1, y: 0 },
};

export default function FacilityPage() {
  return (
    <main className="facility-page">
      <SiteHeader />

      <section className="facility-hero-section">
        <img src="/left-grad.svg" alt="" className="gradient-decorator gradient-decorator-left" />
        <img src="/right-grad.svg" alt="" className="gradient-decorator gradient-decorator-right" />
        <div className="container facility-hero-content">
          <p className="hero-eyebrow">Manufacturing Excellence</p>
          <h1>World-Class Manufacturing & Research Facilities</h1>
          <p>
            GMP-compliant pharmaceutical manufacturing with advanced technology, rigorous quality systems,
            and global regulatory compliance.
          </p>
        </div>
      </section>

      <motion.section className="facility-capabilitiesSection" id="facility-intro">
        <div className="facility-capabilitiesContainer">
          <motion.div
            className="facility-capabilitiesHeader"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true, amount: 0.3 }}
          >
            <motion.p
              className="facility-capabilitiesEyebrow"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              viewport={{ once: true }}
            >
              Our Capabilities
            </motion.p>
            <motion.h2
              className="facility-capabilitiesTitle"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              viewport={{ once: true }}
            >
              Integrated Manufacturing Excellence
            </motion.h2>
            <motion.p
              className="facility-capabilitiesSubtitle"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              viewport={{ once: true }}
            >
              Synergy Pharmaceuticals operates a 10.5-acre integrated manufacturing campus equipped with
              state-of-the-art facilities for solid dosage forms, injectables, oncology products, and hormone-based
              therapeutics.
            </motion.p>
          </motion.div>

          <motion.div
            className="facility-capabilitiesGrid"
            initial="initial"
            whileInView="whileInView"
            variants={staggerContainerVariants}
            viewport={{ once: true, amount: 0.2 }}
          >
            {[
              { 
                title: "WHO-GMP Certified", 
                description: "Every facility engineered to exceed WHO-GMP standards",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                )
              },
              { 
                title: "Comprehensive QA", 
                description: "Advanced quality assurance systems and controls",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                )
              },
              { 
                title: "Environmental Control", 
                description: "Precision-engineered climate and contamination control",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                )
              },
              { 
                title: "Research Ready", 
                description: "Advanced research capabilities and development labs",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l12-7-7 12-5-5z" />
                    <circle cx="12" cy="12" r="1" />
                  </svg>
                )
              },
            ].map((capability, index) => (
              <motion.div
                key={index}
                className="facility-capabilityCard"
                variants={staggerChildVariants}
                transition={{ duration: 0.5, delay: 0.1 + index * 0.08 }}
              >
                <div className="facility-capabilityCardInner">
                  <motion.div 
                    className="facility-capabilityIcon"
                    animate={{ rotateY: 360 }}
                    transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  >
                    <motion.div
                      className="facility-capabilityAnimatedIcon"
                      animate={{ 
                        y: [0, -8, 0],
                      }}
                      transition={{ 
                        duration: 3, 
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    >
                      {capability.icon}
                    </motion.div>
                  </motion.div>
                  <h3 className="facility-capabilityCardTitle">{capability.title}</h3>
                  <p className="facility-capabilityCardDescription">{capability.description}</p>
                </div>
                <div className="facility-capabilityCardAccent" />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.section>

      <section className="facility-facilitiesSection">
        <div className="facility-facilitiesSectionInner">
          <div className="facility-facilitiesHeader">
            <p className="facility-facilitiesHeaderEyebrow">Integrated Operations</p>
            <h2 className="facility-facilitiesTitle">Our Manufacturing Units</h2>
            <p className="facility-facilitiesDescription">
              Integrated pharmaceutical manufacturing facilities designed for precision, compliance, and global
              scalability.
            </p>
          </div>

          <div className="facility-facilitiesGrid">
            {facilities.map((facility) => (
              <motion.div
                key={facility.id}
                className="facility-facilityCard"
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                viewport={{ once: true, amount: 0.3 }}
              >
                <div className="facility-facilityCardImageWrap">
                  <Image src={facility.image} alt={facility.title} fill className="facility-facilityCardImage" />
                 
                </div>

                <div className="facility-facilityCardContent">
                  <h3 className="facility-facilityCardTitle">{facility.title}</h3>
                  <p className="facility-facilityCardText">{facility.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <motion.section className="container section split" id="advanced-manufacturing" {...fadeInUpVariants}>
        <motion.div
          className="facility-operationsContent"
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <motion.p
            className="facility-operationsEyebrow"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            viewport={{ once: true }}
          >
            Advanced Operations
          </motion.p>
          <motion.h2
            className="facility-operationsTitle"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            viewport={{ once: true }}
          >
            State-of-the-Art Manufacturing
          </motion.h2>
          <motion.p
            className="facility-operationsCopy"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            viewport={{ once: true }}
          >
            Our manufacturing facilities represent the pinnacle of pharmaceutical production technology,
            incorporating automation, real-time quality monitoring, and predictive maintenance systems.
          </motion.p>
          <motion.ul
            className="facility-operationsList"
            initial="initial"
            whileInView="whileInView"
            variants={staggerContainerVariants}
            viewport={{ once: true, amount: 0.3 }}
          >
            {[
              "12+ dedicated production lines",
              "ISO Class 6-8 Clean Rooms",
              "Automated material handling systems",
              "Real-time environmental monitoring",
              "Advanced water purification systems",
              "Redundant utility infrastructure",
            ].map((item, index) => (
              <motion.li
                className="facility-operationsListItem"
                key={index}
                variants={staggerChildVariants}
                transition={{ duration: 0.5, delay: 0.3 + index * 0.08 }}
              >
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
        <motion.div
          className="facility-manufacturingAnimation"
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <div className="facility-manufacturingBackdrop" />
          <div className="facility-manufacturingHeader">
            <span className="facility-manufacturingLabel">Smart Factory Flow</span>
            <span className="facility-manufacturingPulse" />
          </div>

          <div className="facility-manufacturingStage">
            <div className="facility-manufacturingGlow" />
            <div className="facility-manufacturingGrid" />
            <div className="facility-manufacturingCore">
              <motion.div
                className="facility-manufacturingRing"
                animate={{ rotate: 360 }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="facility-manufacturingRingInner"
                animate={{ rotate: -360 }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
              />
              <div className="facility-manufacturingHub" />
            </div>

            <div className="facility-manufacturingTrack">
              {[0, 1, 2].map((item) => (
                <motion.span
                  key={item}
                  className="facility-manufacturingCapsule"
                  animate={{ x: ["-10%", "115%"] }}
                  transition={{
                    duration: 4.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: item * 1.1,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="facility-manufacturingStats">
            <div className="facility-manufacturingStatCard">
              <strong>24/7</strong>
              <span>Automated Monitoring</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>ISO</strong>
              <span>Clean Production Cells</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>AI</strong>
              <span>Predictive Maintenance Flow</span>
            </div>
          </div>
        </motion.div>
      </motion.section>

      <motion.section className="container section split" id="specialty-units" {...fadeInUpVariants}>
        <motion.div
          className="facility-manufacturingAnimation"
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <div className="facility-manufacturingBackdrop" />
          <div className="facility-manufacturingHeader">
            <span className="facility-manufacturingLabel">Sterile Specialty Units</span>
            <span className="facility-manufacturingPulse" />
          </div>

          <div className="facility-manufacturingStage">
            <div className="facility-manufacturingGlow" />
            <div className="facility-manufacturingGrid" />
            <div className="facility-manufacturingCore">
              <motion.div
                className="facility-manufacturingRing"
                animate={{ rotate: 360 }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="facility-manufacturingRingInner"
                animate={{ rotate: -360 }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
              />
              <div className="facility-manufacturingHub" />
            </div>

            <div className="facility-manufacturingTrack">
              {[0, 1, 2].map((item) => (
                <motion.span
                  key={item}
                  className="facility-manufacturingCapsule"
                  animate={{ x: ["-10%", "115%"] }}
                  transition={{
                    duration: 4.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: item * 1.1,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="facility-manufacturingStats">
            <div className="facility-manufacturingStatCard">
              <strong>HEPA</strong>
              <span>Filtered isolation airflow</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>SAFE</strong>
              <span>Contained material transfer</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>GMP</strong>
              <span>Dedicated batch segregation</span>
            </div>
          </div>
        </motion.div>
        <motion.div
          className="facility-operationsContent"
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <motion.p
            className="facility-operationsEyebrow"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            viewport={{ once: true }}
          >
            Specialized Capabilities
          </motion.p>
          <motion.h2
            className="facility-operationsTitle"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            viewport={{ once: true }}
          >
            Oncology & Hormone Manufacturing
          </motion.h2>
          <motion.p
            className="facility-operationsCopy"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            viewport={{ once: true }}
          >
            Dedicated facilities for sensitive therapeutic categories with enhanced containment protocols,
            specialized handling procedures, and rigorous environmental controls.
          </motion.p>
          <motion.ul
            className="facility-operationsList"
            initial="initial"
            whileInView="whileInView"
            variants={staggerContainerVariants}
            viewport={{ once: true, amount: 0.3 }}
          >
            {[
              "Contained manufacturing environment",
              "Enhanced ventilation systems",
              "Specialized operator training",
              "Dedicated quality assurance",
              "Isolated waste management",
              "Regulatory compliance documentation",
            ].map((item, index) => (
              <motion.li
                className="facility-operationsListItem"
                key={index}
                variants={staggerChildVariants}
                transition={{ duration: 0.5, delay: 0.3 + index * 0.08 }}
              >
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
      </motion.section>

      <motion.section className="container section split" id="research-center" {...fadeInUpVariants}>
        <motion.div
          className="facility-operationsContent"
          initial={{ opacity: 0, x: -50 }}
          whileInView={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <motion.p
            className="facility-operationsEyebrow"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            viewport={{ once: true }}
          >
            Innovation Hub
          </motion.p>
          <motion.h2
            className="facility-operationsTitle"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            viewport={{ once: true }}
          >
            Research & Development Center
          </motion.h2>
          <motion.p
            className="facility-operationsCopy"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            viewport={{ once: true }}
          >
            Our R&D facility is equipped with advanced analytical instruments, formulation labs, and stability
            chambers supporting drug development from concept to commercial scale-up.
          </motion.p>
          <motion.ul
            className="facility-operationsList"
            initial="initial"
            whileInView="whileInView"
            variants={staggerContainerVariants}
            viewport={{ once: true, amount: 0.3 }}
          >
            {[
              "Formulation development labs",
              "Advanced analytical instruments",
              "Bioavailability testing chambers",
              "Stability study facilities",
              "Process optimization capabilities",
              "Regulatory compliance support",
            ].map((item, index) => (
              <motion.li
                className="facility-operationsListItem"
                key={index}
                variants={staggerChildVariants}
                transition={{ duration: 0.5, delay: 0.3 + index * 0.08 }}
              >
                {item}
              </motion.li>
            ))}
          </motion.ul>
        </motion.div>
        <motion.div
          className="facility-manufacturingAnimation"
          initial={{ opacity: 0, x: 50 }}
          whileInView={{ opacity: 1, x: 0 }}
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.7 }}
          viewport={{ once: true, amount: 0.3 }}
        >
          <div className="facility-manufacturingBackdrop" />
          <div className="facility-manufacturingHeader">
            <span className="facility-manufacturingLabel">Analytical Innovation Lab</span>
            <span className="facility-manufacturingPulse" />
          </div>

          <div className="facility-manufacturingStage">
            <div className="facility-manufacturingGlow" />
            <div className="facility-manufacturingGrid" />
            <div className="facility-manufacturingCore">
              <motion.div
                className="facility-manufacturingRing"
                animate={{ rotate: 360 }}
                transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                className="facility-manufacturingRingInner"
                animate={{ rotate: -360 }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
              />
              <div className="facility-manufacturingHub" />
            </div>

            <div className="facility-manufacturingTrack">
              {[0, 1, 2].map((item) => (
                <motion.span
                  key={item}
                  className="facility-manufacturingCapsule"
                  animate={{ x: ["-10%", "115%"] }}
                  transition={{
                    duration: 4.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: item * 1.1,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="facility-manufacturingStats">
            <div className="facility-manufacturingStatCard">
              <strong>LAB</strong>
              <span>Formulation development suites</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>DATA</strong>
              <span>Advanced analytical validation</span>
            </div>
            <div className="facility-manufacturingStatCard">
              <strong>STAB</strong>
              <span>Long-term stability chambers</span>
            </div>
          </div>
        </motion.div>
      </motion.section>
      
    </main>
  );
}


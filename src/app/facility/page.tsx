"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { ScrollReveal, ScrollRevealContainer, ScrollRevealItem } from "@/components/scroll-reveal";

const facilities = [
  {
    id: 1,
    title: "General Oral Solid Dosage",
    description: "Specialized in the reliable manufacturing of tablets and capsules to global standards.",
    image: "/facilities/manufacturing.jpg",
  },
  {
    id: 2,
    title: "General Oral Solid Dosage ",
    description: "Specialized in the reliable manufacturing of tablets and capsules to global standards.",
    image: "/facilities/osd.jpg",
  },
  {
    id: 3,
    title: "General Injectables ",
    description: "Ensuring precision and sterility in every injectable formulation.",
    image: "/facilities/injectable.jpg",
  },
  {
    id: 4,
    title: "Oncology (OSD & Injectables) ",
    description: "Specialized unit for oncology OSD and injectable formulations with enhanced containment protocols.",
    image: "/facilities/oncology.jpg",
  },
  {
    id: 5,
    title: "Micro Biology Lab",
    description: "Advanced microbial testing and analysis center for product quality assurance and contamination detection.",
    image: "/facilities/research-center.jpg",
  },
  {
    id: 6,
    title: "R&D Center",
    description: "An innovation hub dedicated to developing future-ready pharmaceuticals.",
    image: "/facilities/research.jpg",
  },
  {
    id: 7,
    title: "Quality Control Lab",
    description: "Ensuring product integrity through rigorous testing, high class equipment and quality assurance.",
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

      <Hero
        eyebrow="Manufacturing Excellence"
        heading="Reliable manufacturing driven by innovation and expertise."
        description={
          <>
            Delivering dependable outcomes through continuous improvement and
            <br />
            technical excellence.
          </>
        }
        className="facility-hero-section"
      />

      <motion.section className="facility-capabilitiesSection" id="facility-intro">
        <div className="facility-capabilitiesContainer">
          <ScrollReveal className="facility-capabilitiesHeader">
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
              General OSD
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
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="facility-capabilitiesGrid">
            {[
              { 
                title: "NMRA-GMP Certified", 
                description: "EU-GMP expected Q4 2026",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                )
              },
              { 
                title: "Independent QA", 
                description: "a robust team ensuring our commitment to transparency and world-class quality.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                )
              },
              { 
                title: "5 billion Tablets & Capsules", 
                description: "Our three production lines enable efficient scaling while maintaining flexibility in operations.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l12-7-7 12-5-5z" />
                    <circle cx="12" cy="12" r="1" />
                  </svg>
                )
              },
              { 
                title: "In House R&D", 
                description: "Our 6 Floor R&D centre fuels innovation from concept to completion.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                )
              },
            ].map((capability, index) => (
              <ScrollRevealItem
                key={index}
                className="facility-capabilityCard"
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
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </motion.section>

      <section className="facility-facilitiesSection">
        <div className="facility-facilitiesSectionInner">
          <ScrollReveal className="facility-facilitiesHeader">
            <p className="facility-facilitiesHeaderEyebrow">Integrated Operations</p>
            <h2 className="facility-facilitiesTitle">Manufacturing Facilities </h2>
            <p className="facility-facilitiesDescription">
              State-of-the-art production lines meeting EU-GMP / USFDA guidelines with precision, automation, and quality control systems.
            </p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="facility-facilitiesGrid">
            {facilities.map((facility) => (
              <ScrollRevealItem
                key={facility.id}
                className="facility-facilityCard"
              >
                <div className="facility-facilityCardImageWrap">
                  <Image src={facility.image} alt={facility.title} fill className="facility-facilityCardImage" />
                 
                </div>

                <div className="facility-facilityCardContent">
                  <h3 className="facility-facilityCardTitle">{facility.title}</h3>
                  <p className="facility-facilityCardText">{facility.description}</p>
                </div>
              </ScrollRevealItem>
            ))}
          </ScrollRevealContainer>
        </div>
      </section>

      {/* <motion.section className="container section split" id="advanced-manufacturing" {...fadeInUpVariants}>
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
      </motion.section> */}

      {/* <motion.section className="container section split" id="specialty-units" {...fadeInUpVariants}>
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
              "Isolation Containment",
              "Dedicated Ventilation",
              // "Specialized operator training",
              "Dedicated quality assurance",
              // "Isolated waste management",
              // "Regulatory compliance documentation",
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
      </motion.section> */}

      {/* <motion.section className="container section split" id="research-center" {...fadeInUpVariants}>
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
              // "Formulation development labs",
              // "Advanced analytical instruments",
              // "Bioavailability testing chambers",
              // "Stability study facilities",
              // "Process optimization capabilities",
              // "Regulatory compliance support",
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
      </motion.section> */}

      <motion.section className="facility-qualityComplianceSection" {...fadeInUpVariants}>
        <div className="facility-qualityContainer">
          <motion.div
            className="facility-qualityImage"
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            viewport={{ once: true, amount: 0.3 }}
          >
            <Image
              src="/quality-doctor.png"
              alt="Quality specialist in pharmaceutical setting"
              width={520}
              height={640}
              className="facility-qualityImageContent"
            />
          </motion.div>

          <motion.div
            className="facility-qualityContent"
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            viewport={{ once: true, amount: 0.3 }}
          >
            <motion.p
              className="facility-qualityEyebrow"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              viewport={{ once: true }}
            >
              The Standard of Care
            </motion.p>

            <motion.h2
              className="facility-qualityTitle"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              viewport={{ once: true }}
            >
              Quality & Compliance
            </motion.h2>

            <motion.div
              className="facility-qualityPoints"
              initial="initial"
              whileInView="whileInView"
              variants={staggerContainerVariants}
              viewport={{ once: true, amount: 0.3 }}
            >
              {[
                {
                  title: "Strong Quality Management System (QMS)",
                  description: "End-to-end oversight ensuring every batch meets the Synergy standard of excellence.",
                  icon: "shield"
                },
                {
                  title: "Independent QA & QC teams",
                  description: "Separate Quality Assurance and Control divisions for unbiased analytical reporting.",
                  icon: "users"
                }
              ].map((point, index) => (
                <motion.div
                  key={index}
                  className="facility-qualityPoint"
                  variants={staggerChildVariants}
                  transition={{ duration: 0.5, delay: 0.4 + index * 0.1 }}
                >
                  <div className="facility-qualityPointIcon">
                    {point.icon === "shield" ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    )}
                  </div>
                  <div className="facility-qualityPointContent">
                    <h3>{point.title}</h3>
                    <p>{point.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            <motion.div
              className="facility-qualityCertifications"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              viewport={{ once: true }}
            >
              <div className="facility-certificationsAccent" />
              <div className="facility-certificationsContent">
                <p className="facility-certificationsLabel">International Certifications</p>
                <div className="facility-certificationsGrid">
                  <span className="facility-certification">USFDA</span>
                  <span className="facility-certification">EU-GMP</span>
                  <span className="facility-certification">WHO-GMP</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </motion.section>

    </main>
  );
}


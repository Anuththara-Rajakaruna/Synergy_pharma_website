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
    title: "General Injectables ",
    description: "Ensuring precision and sterility in every injectable formulation.",
    image: "/facilities/osd.jpg",
  },
  {
    id: 3,
    title: "Quality Control Lab",
    description: "Ensuring product integrity through rigorous testing, high class equipment and quality assurance.",
    image: "/facilities/injectable.jpg",
  },
  {
    id: 4,
    title: "Manufacturing Facilities  ",
    description: "State-of-the-art production lines meeting EU-GMP/ USFDA guidelines with precision, automation, and quality control systems. ",
    image: "/facilities/oncology.jpg",
  },
  {
    id: 5,
    title: "Oncology (OSD & Injectables) ",
    description: "Dedicated manufacturing for oncology products with the highest levels of containment and care.",
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
    title: "Microbiology Laboratory",
    description: "Advanced microbiological testing and environmental monitoring facilities ensuring product safety, sterility, and compliance with international quality standards.",
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
          <ScrollReveal className="facility-capabilitiesHeader facility-header">
            <motion.p
              className="facility-eyebrow"
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
              Manufacturing Capabilities
            </motion.h2>
            <motion.p
              className="facility-capabilitiesSubtitle facility-subtitle"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              viewport={{ once: true }}
            >
              Synergy Pharmaceuticals operates a state-of-the-art 10.5-acre integrated manufacturing campus designed
              to support a diverse portfolio of pharmaceutical products. Our manufacturing capabilities include oral
              solid dosage forms, sterile parenterals, oncology products, and hormone-based therapeutics, supported
              by advanced quality systems and research facilities.
            </motion.p>
          </ScrollReveal>

          <ScrollRevealContainer staggerDelay={0.12} className="facility-capabilitiesGrid">
            {[
              {
                title: "Tablets & Capsules (General OSD)",
                description: "Our General Oral Solid Dosage (OSD) manufacturing facility is designed for the large-scale production of tablets and capsules with an annual manufacturing capacity of 5 billion units, meeting international quality standards.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                    <path d="m8.5 8.5 7 7" />
                  </svg>
                )
              },
              {
                title: "Parenterals",
                description: "Dedicated sterile manufacturing facilities for both Large Volume Parenterals (LVP) and Small Volume Parenterals (SVP), designed to deliver safe, high-quality injectable pharmaceutical products.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m18 2 4 4" />
                    <path d="m14 4 6 6" />
                    <path d="M17 7 6 18" />
                    <path d="m9 11 4 4" />
                    <path d="m7 15-1.5 1.5" />
                    <path d="m6 18-4 4" />
                  </svg>
                )
              },
              {
                title: "Independent Quality Assurance",
                description: "An independent Quality Assurance team oversees every stage of manufacturing to ensure full compliance with GMP requirements, regulatory expectations, and the highest quality standards.",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                )
              },
              {
                title: "Research & Development",
                description: "Our six-floor Research & Development Centre drives innovation from formulation development through process optimization and technology transfer, supporting continuous product development.",
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
          <ScrollReveal className="facility-facilitiesHeader facility-header">
            <p className="facility-eyebrow">Integrated Operations</p>
            <h2 className="facility-facilitiesTitle">Manufacturing Facilities </h2>
            <p className="facility-facilitiesDescription facility-subtitle">
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
            className="facility-eyebrow"
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
            className="facility-eyebrow"
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
            className="facility-eyebrow"
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
              className="facility-eyebrow"
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
                  description: "End-to-end oversight ensuring every batch meets the Synergy's standard of excellence.",
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
                  <div className="corporate-value-icon-wrap">
                    <div className="corporate-value-blob-1" />
                    <div className="corporate-value-blob-2" />
                    <div className="corporate-value-glass">
                      {point.icon === "shield" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="22" height="22">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      )}
                    </div>
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
                  <span className="facility-certification">NMRA-GMP</span>
                  <span className="facility-certification">EU-GMP (Q4 2026)</span>
                  <span className="facility-certification">WHO-GMP (Q1 2027)</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </motion.section>

    </main>
  );
}


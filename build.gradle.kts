plugins {
    java
}

subprojects {
    apply(plugin = "java")

    repositories {
        mavenCentral()
    }

    // Compiled by whichever JDK is running Gradle, but targeting Java 17 so the
    // output runs on any modern JRE. Avoids a toolchain pin that would fail when
    // the exact version is not installed, or when `java` on PATH is older than
    // the one that did the compiling.
    tasks.withType<JavaCompile>().configureEach {
        options.release.set(17)
    }

    dependencies {
        "implementation"("com.fasterxml.jackson.core:jackson-databind:2.18.1")
        "testImplementation"(platform("org.junit:junit-bom:5.11.3"))
        "testImplementation"("org.junit.jupiter:junit-jupiter")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        testLogging {
            events("passed", "skipped", "failed")
        }
    }
}

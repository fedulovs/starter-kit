plugins {
    application
}

application {
    mainClass.set("games.GamesMain")
}

tasks.named<JavaExec>("run") {
    // Allows: ./gradlew :games:run --args="--only=nova"
    standardInput = System.`in`
}
